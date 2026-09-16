import { createRenderer } from "vue";
import { EventEmitter } from "node:events";
import { routeLocationKey } from "vue-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient: () => http
}));

import { useVibe64TemporaryAi } from "../../src/composables/useVibe64TemporaryAi.js";

const SESSION_PATH = "/api/app/project-a/vibe64/sessions/session-1";
const CONVERSATION_PATH = `${SESSION_PATH}/temporary-conversations/conversation-1`;
const CLOSED_CONVERSATION = {
  reason: "temporary-conversation-closed",
  conversationId: "conversation-1",
  projectSlug: "project-a",
  sessionId: "session-1"
};
const mountedApps = new Set();

function mountTemporaryAi({ socket = new EventEmitter(), openTask = true } = {}) {
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
        onTaskFinished,
        sessionId: () => "session-1",
        sessionsApiPath: () => "/api/app/project-a/vibe64/sessions"
      });
      return () => null;
    }
  });
  app.provide("jskit.realtime.runtime.client.socket", socket);
  app.provide(routeLocationKey, { params: { slug: "project-a" } });
  app.mount({});
  mountedApps.add(app);
  const task = openTask ? temporary.openTask({ draft: "Repair this conflict.", recoveryOperation: "update" }) : null;
  return {
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
    expect(chat.messages.at(-1).text).toBe("Working on");
    http.request.mockResolvedValueOnce({ ok: true, status: "completed", messages: [
      { id: "user", role: "user", text: "Repair this conflict." },
      { id: "reply", role: "assistant", text: "Work finished." }
    ] });
    // Remove the fixture's unrelated blank tab before its save timer fires.
    await restored.temporary.closeTask(restored.task.id);
    await vi.advanceTimersByTimeAsync(650);
    expect(restored.temporary.activeTask.value.messages.at(-1).text).toBe("Work finished.");
    expect(restored.temporary.activeTask.value.busy).toBe(false);
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
    const { temporary, socket, task } = mountTemporaryAi();
    await vi.advanceTimersByTimeAsync(0);
    http.request.mockResolvedValueOnce({ ok: true, conversations: [] });
    socket.emit("connect");
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
