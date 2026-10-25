import { effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const httpRequest = vi.hoisted(() => vi.fn());
const endpoint = vi.hoisted(() => ({ options: null, resource: null }));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource(options) {
    endpoint.options = options;
    return endpoint.resource;
  }
}));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient: () => ({ request: httpRequest })
}));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent: () => { throw new Error("Archived history has no live updates."); }
}));

import { useArchivedVibe64ConversationHistory } from "../../src/composables/useArchivedVibe64ConversationHistory.js";

function page(turns, pagination = {}) {
  return { ok: true, conversationLog: turns, pagination: { count: turns.length, totalTurnCount: turns.length, ...pagination } };
}

function mount(session = ref({ sessionId: "session-1" })) {
  const scope = effectScope();
  const history = scope.run(() => useArchivedVibe64ConversationHistory({
    projectSlug: ref("project-a"), session, sessionsApiPath: ref("/api/vibe64/sessions")
  }));
  return { history, scope, session };
}

describe("useArchivedVibe64ConversationHistory", () => {
  beforeEach(() => {
    httpRequest.mockReset();
    endpoint.resource = { data: ref(null), isLoading: ref(false), loadError: ref(""), reload: vi.fn(async () => null) };
  });

  it("reads the saved history once, without live updates", async () => {
    const { history, scope } = mount();
    expect(endpoint.options.path.value).toBe("/api/vibe64/sessions/session-1/conversation-log");
    expect(endpoint.options.realtime).toBeNull();
    httpRequest.mockResolvedValueOnce(page([]));
    await endpoint.options.queryOptions.queryFn({ signal: undefined });
    expect(httpRequest).toHaveBeenCalledWith("/api/vibe64/sessions/session-1/conversation-log",
      expect.objectContaining({ method: "GET" }));
    endpoint.resource.data.value = page([{ turnId: "000001", user: { role: "user", text: "Saved question" },
      assistant: { role: "assistant", text: "Saved answer" } }]);
    expect(history.turns.value.map(turn => [turn.user.text, turn.assistant.text, turn.pending])).toEqual([
      ["Saved question", "Saved answer", undefined]
    ]);
    scope.stop();
  });

  it("loads older messages, merges both halves of a split turn and drops them on reload", async () => {
    const { history, scope } = mount();
    const cursor = 'message:["000001","assistant"]';
    endpoint.resource.data.value = page([{ turnId: "000001", user: null,
      assistant: { role: "assistant", messageId: "answer-1", text: "Saved answer" }, paginationPartial: true }], {
      count: 1, limit: 10, pageUnit: "messages", hasMoreBefore: true, oldestTurnId: "000001", nextBeforeTurnId: cursor
    });
    httpRequest.mockResolvedValueOnce(page([{ turnId: "000001", user: { role: "user", messageId: "user-1", text: "Saved question" },
      assistant: null, paginationPartial: true }]));
    let completion;
    expect(await history.loadMore({ complete: value => { completion = value; } })).toBe(true);
    expect(httpRequest.mock.calls[0][1].query).toEqual({ beforeTurnId: cursor, limit: "10" });
    expect(completion).toEqual({ changed: true, loaded: true });
    expect(history.turns.value).toHaveLength(1);
    expect(history.turns.value[0].user.text).toBe("Saved question");
    expect(history.turns.value[0].assistant.text).toBe("Saved answer");
    expect(history.hasMoreBefore.value).toBe(false);
    await history.reload();
    expect(endpoint.resource.reload).toHaveBeenCalledOnce();
    expect(history.turns.value[0].user).toBeNull();
    expect(history.hasMoreBefore.value).toBe(true);
    scope.stop();
  });

  it("keeps an older page from a session left behind out of the next one", async () => {
    const { history, scope, session } = mount();
    endpoint.resource.data.value = page([{ turnId: "000002", user: { role: "user", text: "Later" } }],
      { hasMoreBefore: true, oldestTurnId: "000002" });
    let finish;
    httpRequest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const loading = history.loadMore();
    session.value = { sessionId: "session-2" };
    await nextTick();
    finish(page([{ turnId: "000001", user: { role: "user", text: "Earlier in session one" } }]));
    expect(await loading).toBe(false);
    expect(history.turns.value.map(turn => turn.user.text)).toEqual(["Later"]);
    scope.stop();
  });

  it("reports an older page that could not be loaded", async () => {
    const { history, scope } = mount();
    endpoint.resource.data.value = page([{ turnId: "000002", user: { role: "user", text: "Later" } }],
      { hasMoreBefore: true, oldestTurnId: "000002" });
    httpRequest.mockRejectedValueOnce(new Error("History unavailable"));
    expect(await history.loadMore()).toBe(false);
    expect(history.loadMoreError.value).toBe("History unavailable");
    expect(history.loadingMore.value).toBe(false);
    scope.stop();
  });
});
