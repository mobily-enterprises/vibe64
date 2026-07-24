import { effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const endpointMocks = vi.hoisted(() => ({
  options: null,
  resource: null,
  useEndpointResource: vi.fn()
}));
const httpMocks = vi.hoisted(() => ({
  request: vi.fn()
}));
const realtimeMocks = vi.hoisted(() => ({
  events: [],
  handlers: new Map(),
  socket: {
    connected: false,
    off: vi.fn(),
    on: vi.fn()
  }
}));

vi.mock("@jskit-ai/users-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

vi.mock("@jskit-ai/users-web/client/lib/httpClient", () => ({
  getUsersWebHttpClient() {
    return httpMocks;
  }
}));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    realtimeMocks.events.push(options);
  },
  useRealtimeSocket() {
    return realtimeMocks.socket;
  }
}));

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug() {
    return ref("project-a");
  }
}));

import {
  useVibe64MountedSessionData
} from "../../src/composables/useVibe64MountedSessionData.js";

describe("useVibe64MountedSessionData", () => {
  beforeEach(() => {
    realtimeMocks.events.length = 0;
    realtimeMocks.handlers.clear();
    realtimeMocks.socket.connected = false;
    realtimeMocks.socket.off.mockReset();
    realtimeMocks.socket.on.mockReset();
    realtimeMocks.socket.on.mockImplementation((event, handler) => {
      realtimeMocks.handlers.set(event, handler);
    });
    endpointMocks.options = null;
    httpMocks.request.mockReset();
    httpMocks.request.mockResolvedValue({
      ok: true
    });
    endpointMocks.resource = {
      data: ref(null),
      isFetching: ref(false),
      isInitialLoading: ref(true),
      isLoading: ref(true),
      loadError: ref(""),
      query: {
        refetch: vi.fn(async () => null)
      },
      reload: vi.fn(async () => null)
    };
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockImplementation((options) => {
      endpointMocks.options = options;
      return endpointMocks.resource;
    });
  });

  it("keeps one fixed session live while its host is mounted", async () => {
    const scope = effectScope();
    const sessionId = ref("session-a");
    const summarySession = ref({
      revision: 8,
      sessionId: "session-a",
      sessionName: "Alpha"
    });
    const controller = scope.run(() => useVibe64MountedSessionData({
      sessionId,
      sessionsApiPath: ref("/api/vibe64/sessions"),
      summarySession
    }));

    expect(endpointMocks.options.path.value).toBe("/api/vibe64/sessions/session-a");
    expect(endpointMocks.options.queryOptions.refetchOnMount).toBe("always");
    expect(endpointMocks.options.realtime.matches({
      payload: {
        reason: "session-action-run",
        sessionId: "session-a"
      }
    })).toBe(true);
    expect(endpointMocks.options.realtime.matches({
      payload: {
        reason: "session-action-run",
        sessionId: "session-b"
      }
    })).toBe(false);

    endpointMocks.resource.data.value = {
      agentSession: {
        turn: {
          active: true,
          id: "turn-a",
          state: "active"
        }
      },
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      revision: 10,
      sessionId: "session-a"
    };
    endpointMocks.resource.isInitialLoading.value = false;
    endpointMocks.resource.isLoading.value = false;
    await nextTick();
    expect(controller.session.value.agentSession.turn.active).toBe(true);

    const completionPayload = {
      agentSession: {
        turn: {
          active: false,
          id: "turn-a",
          state: "idle"
        }
      },
      reason: "codex-app-server-turn-idle",
      revision: 11,
      sessionId: "session-a"
    };
    const turnListener = realtimeMocks.events.find((listener) => listener.matches({
      payload: completionPayload
    }));
    expect(turnListener).toBeTruthy();
    turnListener.onEvent({ payload: completionPayload });
    await nextTick();
    expect(controller.session.value.agentSession.turn.active).toBe(false);
    expect(controller.session.value.revision).toBe(11);

    realtimeMocks.socket.connected = true;
    realtimeMocks.handlers.get("connect")();
    await vi.waitFor(() => {
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });
    expect(endpointMocks.resource.query.refetch).toHaveBeenCalledTimes(1);

    scope.stop();
    expect(realtimeMocks.socket.off).toHaveBeenCalledWith(
      "connect",
      expect.any(Function)
    );
    expect(realtimeMocks.socket.off).toHaveBeenCalledWith(
      "connect_error",
      expect.any(Function)
    );
    expect(realtimeMocks.socket.off).toHaveBeenCalledWith(
      "disconnect",
      expect.any(Function)
    );
  });

  it("reconciles an active provider once at the connection boundary", async () => {
    const scope = effectScope();
    const controller = scope.run(() => useVibe64MountedSessionData({
      sessionId: ref("session-a"),
      sessionsApiPath: ref("/api/vibe64/sessions"),
      summarySession: ref(null)
    }));
    endpointMocks.resource.data.value = {
      agentSession: {
        turn: {
          active: true,
          id: "turn-a",
          state: "active"
        }
      },
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      revision: 10,
      sessionId: "session-a"
    };
    endpointMocks.resource.isInitialLoading.value = false;
    endpointMocks.resource.isLoading.value = false;
    await nextTick();

    realtimeMocks.socket.connected = true;
    realtimeMocks.handlers.get("connect")();
    await vi.waitFor(() => {
      expect(httpMocks.request).toHaveBeenCalledWith(
        "/api/vibe64/sessions/session-a/agent-session",
        {
          body: {},
          method: "POST"
        }
      );
    });
    await vi.waitFor(() => {
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });

    expect(endpointMocks.resource.query.refetch).toHaveBeenCalledTimes(2);

    realtimeMocks.socket.connected = false;
    realtimeMocks.handlers.get("disconnect")();
    expect(controller.agentConnectionStatus.value).toBe("disconnected");

    scope.stop();
  });

  it("leaves active assistant status unknown when reconnect reconciliation fails", async () => {
    httpMocks.request.mockResolvedValue({
      error: "Provider unavailable.",
      ok: false
    });
    const scope = effectScope();
    const controller = scope.run(() => useVibe64MountedSessionData({
      sessionId: ref("session-a"),
      sessionsApiPath: ref("/api/vibe64/sessions"),
      summarySession: ref(null)
    }));
    endpointMocks.resource.data.value = {
      agentSession: {
        turn: {
          active: true,
          id: "turn-a",
          state: "active"
        }
      },
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      revision: 10,
      sessionId: "session-a"
    };
    endpointMocks.resource.isInitialLoading.value = false;
    endpointMocks.resource.isLoading.value = false;
    await nextTick();

    realtimeMocks.socket.connected = true;
    realtimeMocks.handlers.get("connect")();
    await vi.waitFor(() => {
      expect(controller.agentConnectionStatus.value).toBe("unknown");
    });

    scope.stop();
  });

  it("does not let a stale response replace a newer fixed-session snapshot", async () => {
    const scope = effectScope();
    const controller = scope.run(() => useVibe64MountedSessionData({
      sessionId: ref("session-a"),
      sessionsApiPath: ref("/api/vibe64/sessions"),
      summarySession: ref(null)
    }));
    const snapshot = (revision, state) => ({
      agentSession: {
        turn: {
          active: state === "active",
          state
        }
      },
      presentation: {
        screen: {
          kind: "conversation"
        }
      },
      revision,
      sessionId: "session-a"
    });

    expect(controller.acceptSessionResponse(snapshot(12, "idle"))).toBe(true);
    expect(controller.acceptSessionResponse(snapshot(11, "active"))).toBe(false);
    await nextTick();
    expect(controller.session.value.revision).toBe(12);
    expect(controller.session.value.agentSession.turn.active).toBe(false);

    scope.stop();
  });
});
