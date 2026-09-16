import { createRenderer } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient: () => http
}));

import { useVibe64TemporaryAi } from "../../src/composables/useVibe64TemporaryAi.js";

const SESSION_PATH = "/api/app/project-a/vibe64/sessions/session-1";
const CONVERSATION_PATH = `${SESSION_PATH}/temporary-conversations/conversation-1`;
const mountedApps = new Set();

function mountTemporaryAi() {
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
  app.mount({});
  mountedApps.add(app);
  const task = temporary.openTask({ draft: "Repair this conflict.", recoveryOperation: "update" });
  return {
    onTaskFinished,
    task,
    temporary,
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

});
