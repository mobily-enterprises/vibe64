import { createRenderer, ref } from "vue";
import { EventEmitter } from "node:events";
import { routeLocationKey } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient: () => http
}));

import { useVibe64TemporaryAi } from "../../src/composables/useVibe64TemporaryAi.js";
import { VIBE64_ASSISTANT_VIEWER_KEY } from "../../src/lib/vibe64AssistantHost.js";

const SESSION_PATH = "/api/app/project-a/vibe64/sessions/session-1";
const CONVERSATION_PATH = `${SESSION_PATH}/temporary-conversations/conversation-1`;
const CLOSED_CONVERSATION = {
  reason: "temporary-conversation-closed",
  conversationId: "conversation-1",
  projectSlug: "project-a",
  sessionId: "session-1"
};
const mountedApps = new Set();

function mountTemporaryAi({
  assistantReady = ref(true),
  socket = new EventEmitter(),
  openTask = true,
  viewer = ref({ actorKey: "owner" }),
  sessionId = () => "session-1"
} = {}) {
  let temporary;
  const onTaskFinished = vi.fn();
  const app = createRenderer({
    createComment: () => ({}),
    insert() {},
    nextSibling: () => null,
    parentNode: () => null,
    remove() {}
  }).createApp({
    setup() {
      temporary = useVibe64TemporaryAi({
        assistantReady,
        onTaskFinished,
        sessionId,
        sessionsApiPath: () => "/api/app/project-a/vibe64/sessions"
      });
      return () => null;
    }
  });
  app.provide("jskit.realtime.runtime.client.socket", socket);
  app.provide(VIBE64_ASSISTANT_VIEWER_KEY, viewer);
  app.provide(routeLocationKey, { params: { slug: "project-a" } });
  app.mount({});
  mountedApps.add(app);
  const task = openTask ? temporary.openTask({ draft: "Repair this conflict.", recoveryOperation: "update" }) : null;
  return {
    assistantReady,
    onTaskFinished,
    task,
    temporary,
    socket,
    unmount() {
      app.unmount();
      mountedApps.delete(app);
    }
  };
}

describe("temporary AI mounted lifetime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    http.request.mockReset();
    http.request.mockResolvedValue({ ok: true, status: "inProgress" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: { origin: "http://vibe64.local", pathname: "/app/project/project-a/development" }
    });
  });

  afterEach(() => {
    for (const app of mountedApps) app.unmount();
    mountedApps.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reloads per-conversation access for a new actor and ignores the old actor's late turn", async () => {
    const viewer = ref({ actorKey: "owner" });
    const started = Promise.withResolvers();
    const record = { conversationId: "conversation-1", status: "ready", messages: [],
      routingMetadata: { assistant_routing: '{"mode":"code","workflowEngineId":"codex"}' },
      purposes: { code: { available: true, effectiveSelection: { engineId: "codex", modelId: "deepseek-flash" } } } };
    http.request.mockImplementation(async (_path, options) => {
      if (options?.method === "POST") return started.promise;
      return { conversations: [{ ...record, purposes: viewer.value.actorKey === "owner" ? record.purposes : {
        code: { available: true, effectiveSelection: { engineId: "opencode", modelId: "big-pickle" } }
      } }] };
    });
    const { temporary } = mountTemporaryAi({ viewer, openTask: false });
    await vi.waitFor(() => expect(temporary.tasks.value).toHaveLength(1));
    temporary.updateDraft("conversation-1", "Implement the agreed design");
    const sending = temporary.send("conversation-1");
    await vi.waitFor(() => expect(http.request.mock.calls.some(([, options]) => options?.method === "POST")).toBe(true));
    viewer.value = { actorKey: "member" };
    expect(temporary.tasks.value).toEqual([]);
    await vi.waitFor(() => expect(temporary.tasks.value[0]?.purposes.code.effectiveSelection.modelId).toBe("big-pickle"));
    started.resolve({ ok: true, status: "inProgress", runId: "owner-run" });
    expect(await sending).toBe(false);
    expect(temporary.tasks.value[0].runId).toBeUndefined();
    expect(temporary.tasks.value[0].messages).toEqual([]);
    viewer.value = { actorKey: "" };
    expect(temporary.tasks.value).toEqual([]);
  });

  it("shares a pending restoration across account and connection refreshes", async () => {
    const restoring = Promise.withResolvers();
    http.request.mockReturnValue(restoring.promise);
    const socket = new EventEmitter();
    const anyListeners = new Set();
    socket.onAny = (handler) => anyListeners.add(handler);
    socket.offAny = (handler) => anyListeners.delete(handler);
    const emit = socket.emit.bind(socket);
    socket.emit = (...args) => {
      for (const handler of anyListeners) handler(...args);
      return emit(...args);
    };
    const { temporary } = mountTemporaryAi({ openTask: false, socket });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 10; i += 1) socket.emit("vibe64.session.changed", { reason: "progress" });
    await vi.advanceTimersByTimeAsync(0);
    expect(http.request).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 10; i += 1) {
      socket.emit("vibe64.accounts.changed", {});
      socket.emit("vibe64.connections.changed", {});
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(http.request).toHaveBeenCalledTimes(1);
    restoring.resolve({ conversations: [{ conversationId: "conversation-1", status: "ready", messages: [] }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(http.request).toHaveBeenCalledTimes(2);
    expect(temporary.tasks.value).toHaveLength(1);
    await temporary.restoreTasks();
    expect(http.request).toHaveBeenCalledTimes(3);
  });

  it("coalesces routing events while a conversation read is pending", async () => {
    const reading = Promise.withResolvers();
    http.request.mockImplementation(async (url) => url === CONVERSATION_PATH ? reading.promise : {
      ok: true, conversations: [{ conversationId: "conversation-1", status: "routing", messages: [] }]
    });
    const { temporary, socket } = mountTemporaryAi({ openTask: false });
    await vi.advanceTimersByTimeAsync(0);
    const reads = () => http.request.mock.calls.filter(([url]) => url === CONVERSATION_PATH);
    expect(reads()).toHaveLength(1);
    for (let i = 0; i < 10; i += 1) {
      socket.emit("vibe64.session.changed", { ...CLOSED_CONVERSATION,
        reason: "assistant-routing-changed", assistantRoutingRequest: { status: "routing", messageId: "request-1" }
      });
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect(reads()).toHaveLength(1);
    reading.resolve({ ok: true, status: "completed", messages: [{ id: "reply", role: "assistant", text: "Done." }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(temporary.activeTask.value.busy).toBe(false);
    expect(temporary.activeTask.value.messages.at(-1).text).toBe("Done.");
    await vi.advanceTimersByTimeAsync(2000);
    expect(reads()).toHaveLength(1);
  });

  it("observes a new turn after the stopped turn's pending read settles", async () => {
    const oldRead = Promise.withResolvers();
    let turn = 0;
    let reads = 0;
    http.request.mockImplementation(async (url, options) => {
      if (url.endsWith("/turns")) return { ok: true, status: "inProgress", runId: `turn-${++turn}` };
      if (url.endsWith("/stop")) return { ok: true, status: "interrupted" };
      if (url === CONVERSATION_PATH && options.method === "GET") {
        reads += 1;
        return reads === 1 ? oldRead.promise : { ok: true, status: "completed", runId: "turn-2",
          messages: [{ id: "new-reply", role: "assistant", text: "Second turn finished." }] };
      }
      return { ok: true, conversations: [{ conversationId: "conversation-1", status: "ready", messages: [] }] };
    });
    const { temporary } = mountTemporaryAi({ openTask: false });
    await vi.advanceTimersByTimeAsync(0);
    temporary.updateDraft("conversation-1", "First task");
    await temporary.send("conversation-1");
    expect(reads).toBe(1);
    await temporary.stopTask("conversation-1");
    temporary.updateDraft("conversation-1", "Second task");
    await temporary.send("conversation-1");
    expect(reads).toBe(1);
    expect(temporary.activeTask.value.runId).toBe("turn-2");
    oldRead.resolve({ ok: true, status: "completed", runId: "turn-1", messages: [
      { id: "old-reply", role: "assistant", text: "Stale response" }
    ] });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(2);
    expect(temporary.activeTask.value.busy).toBe(false);
    expect(temporary.activeTask.value.messages.at(-1).text).toBe("Second turn finished.");
  });

  it("shows a pending message throughout conversation creation and turn startup, then reconciles it once", async () => {
    const creation = Promise.withResolvers();
    const starting = Promise.withResolvers();
    const { temporary, task } = mountTemporaryAi();
    task.agentSettings.model = "original-model";
    http.request.mockReturnValueOnce(creation.promise).mockReturnValueOnce(starting.promise);
    const sending = temporary.send(task.id);
    const current = () => temporary.activeTask.value;
    const turns = () => current().delivery.turns([]);
    expect(current().draft).toBe("");
    expect(current().delivery.state.sending).toBe(true);
    expect(turns()).toHaveLength(1);
    expect(turns()[0]).toMatchObject({
      optimistic: { status: "pending" }, user: { text: "Repair this conflict." }
    });
    const messageId = turns()[0].user.messageId;
    task.agentSettings.model = "changed-before-creation-finished";
    creation.resolve({ ok: true, conversationId: "conversation-1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(current().delivery.state.sending).toBe(true);
    expect(turns()).toHaveLength(1);
    expect(http.request).toHaveBeenLastCalledWith(`${CONVERSATION_PATH}/turns`, expect.objectContaining({
      body: expect.objectContaining({
        messageId,
        agentSettings: expect.objectContaining({ model: "original-model" }),
        presentation: expect.objectContaining({ draft: "" })
      })
    }));
    temporary.updateDraft(task.id, "A draft typed while startup is pending.");
    await vi.advanceTimersByTimeAsync(250);
    starting.resolve({ ok: true, status: "completed", runId: "turn-1", messages: [
      { id: messageId, role: "user", text: "Repair this conflict." },
      { id: "answer-1", role: "assistant", text: "Done.", status: "completed" }
    ] });
    await expect(sending).resolves.toBe(true);
    expect(current().delivery.state.sending).toBe(false);
    expect(current().delivery.state.messages).toEqual([]);
    expect(current().messages.filter((message) => message.role === "user")).toHaveLength(1);
    http.request.mockClear();
    await vi.advanceTimersByTimeAsync(250);
    expect(http.request).toHaveBeenCalledWith(CONVERSATION_PATH, expect.objectContaining({
      method: "PATCH", body: expect.objectContaining({
        presentation: expect.objectContaining({ draft: "A draft typed while startup is pending." })
      })
    }));
  });

  it("retries a failed message with its original identity and payload while preserving a newer draft", async () => {
    const { temporary, task } = mountTemporaryAi();
    temporary.updateAttachments(task.id, [{ attachmentId: "original-file", fileName: "first.txt" }]);
    http.request.mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockRejectedValueOnce(new Error("Provider unavailable."));
    await expect(temporary.send(task.id)).resolves.toBe(false);
    const failed = temporary.activeTask.value.delivery.state.messages[0];
    expect(failed).toMatchObject({ text: "Repair this conflict.", status: "failed", error: "Provider unavailable." });
    const originalBody = http.request.mock.calls.find(([path]) => path.endsWith("/turns"))[1].body;
    temporary.updateDraft(task.id, "A newer question.");
    temporary.updateAgentSetting(task.id, "model", "another-model");
    temporary.updateAttachments(task.id, [
      { attachmentId: "original-file", fileName: "first.txt" },
      { attachmentId: "new-file", fileName: "next.txt" }
    ]);
    http.request.mockResolvedValueOnce({ ok: true, status: "completed", runId: "turn-1" });
    await expect(temporary.send(task.id, { retryMessageId: failed.id })).resolves.toBe(true);
    const bodies = http.request.mock.calls.filter(([path]) => path.endsWith("/turns")).map(([, options]) => options.body);
    expect(bodies).toEqual([originalBody, originalBody]);
    expect(temporary.activeTask.value.draft).toBe("A newer question.");
    expect(temporary.activeTask.value.delivery.state.messages).toEqual([]);
    expect(temporary.activeTask.value.attachments.map((file) => file.attachmentId)).toEqual(["new-file"]);
    await vi.advanceTimersByTimeAsync(250);
    expect(http.request).toHaveBeenLastCalledWith(CONVERSATION_PATH, expect.objectContaining({
      method: "PATCH", body: expect.objectContaining({
        attachmentIds: ["new-file"], presentation: expect.objectContaining({ draft: "A newer question." })
      })
    }));
  });

  it.each(["editMessage", "cancelMessage"])("%s removes the failed entry without losing a newer draft", async (action) => {
    const { temporary, task } = mountTemporaryAi();
    http.request.mockRejectedValueOnce(new Error("Provider unavailable."));
    await temporary.send(task.id);
    const messageId = temporary.activeTask.value.delivery.state.messages[0].id;
    temporary.updateDraft(task.id, "My next question.");
    expect(await temporary[action](task.id, messageId)).toBe(true);
    expect(temporary.activeTask.value.delivery.state.messages).toEqual([]);
    expect(temporary.activeTask.value.draft).toBe(action === "editMessage"
      ? "Repair this conflict.\n\nMy next question." : "My next question.");
  });

  it("waits for shared assistant readiness before restoring, including manual retry", async () => {
    const assistantReady = ref(false);
    http.request.mockResolvedValue({ ok: true, conversations: [{ conversationId: "conversation-1", status: "ready", draft: "Keep this" }] });
    const { temporary } = mountTemporaryAi({ assistantReady, openTask: false });
    await temporary.restoreTasks();
    await vi.advanceTimersByTimeAsync(5000);
    expect(http.request).not.toHaveBeenCalled();
    expect(temporary.open.value).toBe(false);
    expect(temporary.restoreError.value).toBe("");
    expect(vi.getTimerCount()).toBe(0);

    assistantReady.value = true;
    await vi.advanceTimersByTimeAsync(0);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(temporary.activeTask.value.draft).toBe("Keep this");
    expect(temporary.open.value).toBe(true);
  });

  it("restores when mounted after initialization without needing a ready event", async () => {
    const { temporary } = mountTemporaryAi({ openTask: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(http.request).toHaveBeenCalledExactlyOnceWith(`${SESSION_PATH}/temporary-conversations`, { method: "GET" });
    expect(temporary.open.value).toBe(false);
  });

  it("cancels a busy retry while readiness is lost and resumes after reconciliation", async () => {
    http.request.mockResolvedValueOnce({ ok: false, code: "vibe64_agent_write_mode_busy", error: "Busy" });
    const { assistantReady, socket, temporary } = mountTemporaryAi({ openTask: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    assistantReady.value = false;
    socket.emit("connect");
    await vi.advanceTimersByTimeAsync(3000);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(temporary.restoreError.value).toBe("");
    assistantReady.value = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(http.request).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ok: true, conversations: [{ conversationId: "obsolete", status: "ready" }] },
    { ok: false, code: "vibe64_agent_write_mode_busy", error: "Busy" },
    { ok: false, error: "Failed on the old connection" }
  ])("ignores an obsolete restoration response after readiness is lost: $ok $error", async (response) => {
    const listing = Promise.withResolvers();
    http.request.mockReturnValueOnce(listing.promise);
    const { assistantReady, temporary } = mountTemporaryAi({ openTask: false });
    assistantReady.value = false;
    await vi.advanceTimersByTimeAsync(0);
    assistantReady.value = true;
    await vi.advanceTimersByTimeAsync(0);
    listing.resolve(response);
    await vi.advanceTimersByTimeAsync(3000);
    expect(http.request).toHaveBeenCalledTimes(2);
    expect(temporary.tasks.value).toEqual([]);
    expect(temporary.restoreError.value).toBe("");
    expect(temporary.open.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for a new session's readiness and ignores the previous session's pending restore", async () => {
    const sessionId = ref("session-1");
    const listing = Promise.withResolvers();
    http.request.mockReturnValueOnce(listing.promise);
    const { assistantReady, temporary } = mountTemporaryAi({ openTask: false, sessionId });
    sessionId.value = "session-2";
    assistantReady.value = false;
    await vi.advanceTimersByTimeAsync(0);
    listing.resolve({ ok: true, conversations: [{ conversationId: "obsolete", status: "ready" }] });
    await vi.advanceTimersByTimeAsync(0);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(temporary.tasks.value).toEqual([]);
    assistantReady.value = true;
    await vi.advanceTimersByTimeAsync(0);
    expect(http.request).toHaveBeenCalledTimes(2);
    expect(http.request).toHaveBeenLastCalledWith(
      "/api/app/project-a/vibe64/sessions/session-2/temporary-conversations", { method: "GET" }
    );
  });

  it.each([false, true])("retries busy restoration without replacing main chat (saved chat: %s)", async (savedChat) => {
    const busy = { ok: false, code: "vibe64_agent_write_mode_busy", error: "The assistant is still reconnecting." };
    http.request.mockResolvedValueOnce(busy)
      .mockRejectedValueOnce(Object.assign(new Error(busy.error), { code: busy.code }))
      .mockResolvedValueOnce({ ok: true, conversations: savedChat ? [{ conversationId: "conversation-1", status: "ready", draft: "Keep this" }] : [] });
    const { temporary } = mountTemporaryAi({ openTask: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(temporary.open.value).toBe(false);
    expect(temporary.restoreError.value).toBe("");
    await vi.advanceTimersByTimeAsync(1000);
    expect(temporary.open.value).toBe(false);
    expect(temporary.restoreError.value).toBe("");
    await vi.advanceTimersByTimeAsync(1000);
    expect(temporary.open.value).toBe(savedChat);
    expect(temporary.tasks.value).toHaveLength(savedChat ? 1 : 0);
    if (savedChat) expect(temporary.activeTask.value.draft).toBe("Keep this");
    expect(temporary.restoreError.value).toBe("");
    expect(http.request).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending restoration retry when the view unmounts", async () => {
    http.request.mockResolvedValue({ ok: false, code: "vibe64_agent_write_mode_busy", error: "Busy" });
    const { unmount } = mountTemporaryAi({ openTask: false });
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    await vi.advanceTimersByTimeAsync(3000);
    expect(http.request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not carry a pending restoration retry into another session", async () => {
    const sessionId = ref("session-1");
    http.request.mockResolvedValueOnce({ ok: false, code: "vibe64_agent_write_mode_busy", error: "Busy" })
      .mockResolvedValue({ ok: true, conversations: [] });
    const { temporary } = mountTemporaryAi({ openTask: false, sessionId });
    await vi.advanceTimersByTimeAsync(0);
    sessionId.value = "session-2";
    await vi.advanceTimersByTimeAsync(3000);
    expect(http.request.mock.calls.map(([path]) => path)).toEqual([
      `${SESSION_PATH}/temporary-conversations`,
      "/api/app/project-a/vibe64/sessions/session-2/temporary-conversations"
    ]);
    expect(temporary.open.value).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still exposes a genuine restoration failure with manual retry", async () => {
    http.request.mockResolvedValueOnce({ ok: false, error: "Saved conversations could not be read." });
    const { temporary } = mountTemporaryAi({ openTask: false });
    await vi.advanceTimersByTimeAsync(3000);
    expect(temporary.restoreError.value).toContain("Saved conversations could not be read.");
    expect(temporary.open.value).toBe(true);
    expect(http.request).toHaveBeenCalledTimes(1);
    http.request.mockResolvedValueOnce({ ok: true, conversations: [{ conversationId: "conversation-1", status: "ready" }] });
    await temporary.restoreTasks();
    expect(temporary.restoreError.value).toBe("");
    expect(temporary.tasks.value).toHaveLength(1);
  });

  it.each([
    { ok: true, status: "inProgress" },
    { ok: true, status: "completed", outcome: { kind: "complete" }, text: "Repaired." },
    { ok: false, error: "The provider connection was lost." }
  ])("retires an in-flight poll on unmount: $status $error", async (response) => {
    const poll = Promise.withResolvers();
    const { onTaskFinished, task, temporary, unmount } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockResolvedValueOnce({ ok: true, runId: "turn-1", status: "inProgress" })
      .mockReturnValueOnce(poll.promise);
    await temporary.send(task.id);
    expect(http.request).toHaveBeenLastCalledWith(CONVERSATION_PATH, { method: "GET" });
    const stateBefore = temporary.activeTask.value;
    unmount();
    expect(fetch).not.toHaveBeenCalled();
    poll.resolve(response);
    await vi.advanceTimersByTimeAsync(1950);
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(http.request).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
    expect(temporary.activeTask.value).toBe(stateBefore);
  });

  it("retains a conversation created after unmount without starting an AI turn", async () => {
    const creating = Promise.withResolvers();
    const { onTaskFinished, task, temporary, unmount } = mountTemporaryAi();
    http.request.mockReturnValueOnce(creating.promise);
    const sending = temporary.send(task.id);
    unmount();
    expect(fetch).not.toHaveBeenCalled();
    creating.resolve({ ok: true, conversationId: "conversation-1" });
    await expect(sending).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(1950);
    expect(http.request.mock.calls).toEqual([
      [expect.stringContaining("/temporary-conversations"), { method: "GET" }],
      [expect.stringContaining("/temporary-conversations"), expect.objectContaining({ method: "POST" })]
    ]);
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { ok: true, runId: "turn-1", status: "inProgress" },
    { ok: false, error: "The turn could not start." }
  ])("retires a turn-start response on unmount: $ok", async (response) => {
    const starting = Promise.withResolvers();
    const { onTaskFinished, task, temporary, unmount } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockReturnValueOnce(starting.promise);
    const sending = temporary.send(task.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(http.request).toHaveBeenCalledTimes(3);
    unmount();
    const stateBefore = temporary.activeTask.value;
    starting.resolve(response);
    await expect(sending).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(1950);
    expect(fetch).not.toHaveBeenCalled();
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(http.request).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(temporary.activeTask.value).toBe(stateBefore);
  });

  it.each(["stopTask", "closeTask"])("retires an in-flight %s failure after unmount", async (operation) => {
    const stopping = Promise.withResolvers();
    const { onTaskFinished, task, temporary, unmount } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockResolvedValueOnce({ ok: true, runId: "turn-1", status: "inProgress" });
    await temporary.send(task.id);
    await vi.advanceTimersByTimeAsync(0);
    http.request.mockReturnValueOnce(stopping.promise);
    const stop = temporary[operation](task.id);
    const retired = expect(stop).resolves.toBe(operation === "stopTask" ? false : undefined);
    unmount();
    const stateBefore = temporary.activeTask.value;
    stopping.resolve({ ok: false, error: "Could not stop the AI." });
    await retired;
    await vi.advanceTimersByTimeAsync(1950);
    expect(http.request).toHaveBeenCalledTimes(5);
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(temporary.activeTask.value).toBe(stateBefore);
  });

  it.each([
    { ok: true },
    { ok: false, error: "Could not delete the conversation." }
  ])("retires an in-flight deletion after its view is removed: $ok", async (response) => {
    const deletion = Promise.withResolvers();
    const { onTaskFinished, task, temporary, unmount } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockResolvedValueOnce({ ok: true, runId: "turn-1", status: "inProgress" });
    await temporary.send(task.id);
    await vi.advanceTimersByTimeAsync(0);
    await temporary.stopTask(task.id);
    http.request.mockReturnValueOnce(deletion.promise);
    const closing = temporary.closeTask(task.id);
    const retired = expect(closing).resolves.toBeUndefined();
    unmount();
    const stateBefore = temporary.activeTask.value;
    deletion.resolve(response);
    await retired;
    expect(http.request).toHaveBeenCalledTimes(6);
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(temporary.activeTask.value).toBe(stateBefore);
  });

  it.each(["stopTask", "closeTask"])("retires a successful in-flight %s on unmount", async (operation) => {
    const stopping = Promise.withResolvers();
    const { onTaskFinished, task, temporary, unmount } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockResolvedValueOnce({ ok: true, runId: "turn-1", status: "inProgress" });
    await temporary.send(task.id);
    await vi.advanceTimersByTimeAsync(0);
    http.request.mockReturnValueOnce(stopping.promise);
    const closing = temporary[operation](task.id);
    unmount();
    const stateBefore = temporary.activeTask.value;
    stopping.resolve({ ok: true });
    await closing;
    await vi.advanceTimersByTimeAsync(1950);
    expect(http.request).toHaveBeenCalledTimes(5);
    expect(fetch).not.toHaveBeenCalled();
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(temporary.activeTask.value).toBe(stateBefore);
  });

  it("keeps a hidden but mounted task polling and reports its completion", async () => {
    const { onTaskFinished, task, temporary } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockResolvedValueOnce({ ok: true, runId: "turn-1", status: "inProgress" });
    await temporary.send(task.id);
    await vi.advanceTimersByTimeAsync(0);
    temporary.closeWorkspace();
    http.request.mockResolvedValueOnce({
      ok: true, status: "completed", outcome: { kind: "complete" }, text: "Repaired."
    });
    await vi.advanceTimersByTimeAsync(650);
    expect(onTaskFinished).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      id: task.id, status: "completed", outcomeKind: "complete", recoveryOperation: "update"
    }));
    expect(http.request).toHaveBeenCalledTimes(5);
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores a running server conversation after reload and streams subsequent messages", async () => {
    const { task, temporary, unmount } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockResolvedValueOnce({ ok: true, runId: "turn-1", status: "inProgress" });
    await temporary.send(task.id);
    unmount();
    expect(http.request.mock.calls.some(([, options]) => options.method === "DELETE")).toBe(false);
    http.request.mockResolvedValueOnce({ ok: true, conversations: [{
      conversationId: "conversation-1", title: "Saved task", status: "inProgress", runId: "turn-1",
      goal: { status: "active", objective: "Finish the repair" },
      draft: "My next question", messages: [{ id: "user", role: "user", text: "Repair this conflict." }]
    }] });
    http.request.mockResolvedValueOnce({ ok: true, status: "inProgress", runId: "turn-1", messages: [
      { id: "user", role: "user", text: "Repair this conflict." },
      { id: "reply", role: "assistant", text: "Working on" }
    ] });
    const restored = mountTemporaryAi();
    await vi.advanceTimersByTimeAsync(0);
    const chat = restored.temporary.tasks.value.find((candidate) => candidate.conversationId === "conversation-1");
    expect(chat).toMatchObject({ busy: true, draft: "My next question", title: "Saved task" });
    expect(chat.goal).toMatchObject({ status: "active", objective: "Finish the repair" });
    expect(chat.messages.at(-1).text).toBe("Working on");
    http.request.mockResolvedValueOnce({ ok: true, status: "completed", goal: null, messages: [
      { id: "user", role: "user", text: "Repair this conflict." },
      { id: "reply", role: "assistant", text: "Work finished." }
    ] });
    // Remove the fixture's unrelated blank tab before its save timer fires.
    await restored.temporary.closeTask(restored.task.id);
    await vi.advanceTimersByTimeAsync(650);
    expect(restored.temporary.activeTask.value.messages.at(-1).text).toBe("Work finished.");
    expect(restored.temporary.activeTask.value.busy).toBe(false);
    expect(restored.temporary.activeTask.value.goal).toBeNull();
    expect(restored.temporary.activeTask.value.draft).toBe("My next question");
  });

  it("retains a failed Close on reload and lets the user retry that exact conversation", async () => {
    http.request.mockResolvedValueOnce({ ok: true, conversations: [{
      conversationId: "conversation-1", title: "Closing task", state: "closing", status: "closing",
      error: "Stop not confirmed", messages: [], attachments: []
    }] });
    const { temporary, task } = mountTemporaryAi();
    await vi.advanceTimersByTimeAsync(0);
    await temporary.closeTask(task.id);
    expect(temporary.activeTask.value).toMatchObject({ status: "closing", error: "Stop not confirmed" });
    http.request.mockResolvedValueOnce({ ok: true, deleted: true });
    await temporary.closeTask("conversation-1");
    expect(http.request).toHaveBeenLastCalledWith(CONVERSATION_PATH, { method: "DELETE" });
    expect(temporary.tasks.value).toEqual([]);
  });

  it.each(["POST", "PATCH"])("automatically retries a busy draft %s and clears its save error", async (method) => {
    let busy = true;
    http.request.mockImplementation(async (_path, options) => {
      if (options.method === "GET") return { ok: true, conversations: [] };
      if (options.method === method && busy) {
        busy = false;
        return { ok: false, code: "vibe64_agent_write_mode_busy", error: "Another assistant operation is starting." };
      }
      return { ok: true, conversationId: "conversation-1" };
    });
    const { temporary } = mountTemporaryAi();
    await vi.advanceTimersByTimeAsync(250);
    expect(temporary.activeTask.value.error).toContain("Draft could not be saved:");
    await vi.advanceTimersByTimeAsync(1000);
    expect(temporary.activeTask.value.error).toBe("");
    expect(http.request).toHaveBeenLastCalledWith(CONVERSATION_PATH, expect.objectContaining({
      method: "PATCH", body: expect.objectContaining({ presentation: expect.objectContaining({ draft: "Repair this conflict." }) })
    }));
    expect(http.request.mock.calls.filter(([, options]) => options.method === method)).toHaveLength(2);
  });

  it("closes the exact tab in both mounted clients and cancels the other client's pending draft save", async () => {
    const socket = new EventEmitter();
    http.request.mockImplementation(async (_path, options) => {
      if (options.method === "GET") return { ok: true, conversations: [
        { conversationId: "conversation-1", status: "ready" },
        { conversationId: "conversation-2", status: "ready" }
      ] };
      if (options.method === "DELETE") socket.emit("vibe64.session.changed", CLOSED_CONVERSATION);
      return { ok: true };
    });
    const first = mountTemporaryAi({ socket, openTask: false });
    const second = mountTemporaryAi({ socket, openTask: false });
    await vi.advanceTimersByTimeAsync(0);
    second.temporary.updateDraft("conversation-1", "Ideas?");
    await first.temporary.closeTask("conversation-1");
    for (const { temporary } of [first, second]) {
      expect(temporary.tasks.value.map((task) => task.id)).toEqual(["conversation-2"]);
      expect(temporary.activeTask.value.id).toBe("conversation-2");
    }
    await expect(second.temporary.send("conversation-1")).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(http.request.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "GET", "DELETE"]);
    first.unmount();
    second.unmount();
    expect(socket.listenerCount("connect")).toBe(0);
    expect(socket.listenerCount("vibe64.session.changed")).toBe(0);
  });

  it("scopes closure events to the project and session and ignores a late restoration of a closed chat", async () => {
    const listing = Promise.withResolvers();
    http.request.mockResolvedValueOnce({ ok: true, conversations: [{ conversationId: "conversation-1", status: "ready" }] });
    const { temporary, socket } = mountTemporaryAi({ openTask: false });
    await vi.advanceTimersByTimeAsync(0);
    socket.emit("vibe64.session.changed", { ...CLOSED_CONVERSATION, projectSlug: "project-b" });
    socket.emit("vibe64.session.changed", { ...CLOSED_CONVERSATION, sessionId: "session-2" });
    expect(temporary.tasks.value).toHaveLength(1);
    http.request.mockReturnValueOnce(listing.promise);
    const restoring = temporary.restoreTasks();
    socket.emit("vibe64.session.changed", CLOSED_CONVERSATION);
    expect(temporary.tasks.value).toEqual([]);
    listing.resolve({ ok: true, conversations: [{ conversationId: "conversation-1", status: "ready" }] });
    await restoring;
    expect(temporary.tasks.value).toEqual([]);
  });

  it("reconciles missed closures on reconnect while preserving a new local draft", async () => {
    http.request.mockResolvedValueOnce({ ok: true, conversations: [{ conversationId: "conversation-1", status: "ready" }] });
    const { assistantReady, temporary, socket, task } = mountTemporaryAi();
    await vi.advanceTimersByTimeAsync(0);
    assistantReady.value = false;
    await vi.advanceTimersByTimeAsync(0);
    http.request.mockResolvedValueOnce({ ok: true, conversations: [] });
    socket.emit("connect");
    await vi.advanceTimersByTimeAsync(0);
    expect(temporary.tasks.value).toHaveLength(2);
    assistantReady.value = true;
    await vi.advanceTimersByTimeAsync(0);
    expect(temporary.tasks.value.map((task) => task.id)).toEqual([task.id]);
    expect(temporary.activeTask.value.draft).toBe("Repair this conflict.");
  });

  it("does not follow a late creation response with a draft save or Send after remote Close", async () => {
    const creating = Promise.withResolvers();
    const { temporary, socket, task } = mountTemporaryAi();
    http.request.mockReturnValueOnce(creating.promise);
    await vi.advanceTimersByTimeAsync(250);
    const sending = temporary.send(task.id);
    socket.emit("vibe64.session.changed", { ...CLOSED_CONVERSATION, conversationId: task.id });
    creating.resolve({ ok: true, conversationId: task.id });
    await expect(sending).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(temporary.tasks.value).toEqual([]);
    expect(http.request.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "POST"]);
  });

  it.each(["PATCH", "POST"])("removes a closed conversation reported by %s even without its realtime event", async (method) => {
    http.request.mockResolvedValueOnce({ ok: true, conversations: [{ conversationId: "conversation-1", status: "ready" }] });
    const { temporary } = mountTemporaryAi({ openTask: false });
    await vi.advanceTimersByTimeAsync(0);
    temporary.updateDraft("conversation-1", "Ideas?");
    http.request.mockRejectedValueOnce(Object.assign(new Error("This conversation has been closed."), { code: "vibe64_conversation_closed", status: 404 }));
    if (method === "PATCH") await vi.advanceTimersByTimeAsync(250);
    else await expect(temporary.send("conversation-1")).resolves.toBe(false);
    expect(temporary.tasks.value).toEqual([]);
    await expect(temporary.send("conversation-1")).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(http.request.mock.calls.map(([, options]) => options.method)).toEqual(["GET", method]);
  });

  it.each(["poll", "stopTask", "closeTask"])("ignores a late %s failure after another browser closes the conversation", async (operation) => {
    const response = Promise.withResolvers();
    const { temporary, task, socket, onTaskFinished } = mountTemporaryAi();
    http.request
      .mockResolvedValueOnce({ ok: true, conversationId: "conversation-1" })
      .mockResolvedValueOnce({ ok: true, runId: "turn-1", status: "inProgress" });
    await temporary.send(task.id);
    await vi.advanceTimersByTimeAsync(0);
    http.request.mockReturnValueOnce(response.promise);
    let pending;
    if (operation === "poll") await vi.advanceTimersByTimeAsync(650);
    else pending = temporary[operation](task.id);
    socket.emit("vibe64.session.changed", CLOSED_CONVERSATION);
    expect(temporary.tasks.value).toEqual([]);
    const calls = http.request.mock.calls.length;
    response.resolve({ ok: false, error: "Connection lost." });
    await pending;
    await vi.advanceTimersByTimeAsync(2000);
    expect(http.request).toHaveBeenCalledTimes(calls);
    expect(onTaskFinished).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards queued saves after another browser closes the conversation", async () => {
    http.request.mockResolvedValueOnce({ ok: true, conversations: [{ conversationId: "conversation-1", status: "ready" }] });
    const { temporary, socket } = mountTemporaryAi({ openTask: false });
    await vi.advanceTimersByTimeAsync(0);
    const saving = Promise.withResolvers();
    http.request.mockReturnValueOnce(saving.promise);
    temporary.updateDraft("conversation-1", "First edit");
    await vi.advanceTimersByTimeAsync(250);
    temporary.updateDraft("conversation-1", "Second edit");
    await vi.advanceTimersByTimeAsync(250);
    socket.emit("vibe64.session.changed", CLOSED_CONVERSATION);
    saving.resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(temporary.tasks.value).toEqual([]);
    expect(http.request.mock.calls.map(([, options]) => options.method)).toEqual(["GET", "PATCH"]);
  });

});
