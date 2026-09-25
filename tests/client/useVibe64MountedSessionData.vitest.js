import { effectScope, nextTick, ref } from "vue";
import { QueryClient } from "@tanstack/vue-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    connect: vi.fn(),
    connected: false,
    off: vi.fn(),
    on: vi.fn()
  }
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient() {
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
    realtimeMocks.socket.connect.mockReset();
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
    const queryClient = new QueryClient();
    const detailKey = endpointMocks.options.queryKey.value;
    const accessKey = [...detailKey.slice(0, -1), "assistant-access"];
    queryClient.setQueryData(detailKey, { sessionId: "session-a" });
    queryClient.setQueryData(accessKey, { allowed: true });
    await queryClient.invalidateQueries({ queryKey: detailKey });
    expect(queryClient.getQueryState(detailKey).isInvalidated).toBe(true);
    expect(queryClient.getQueryState(accessKey).isInvalidated).toBe(false);
    queryClient.clear();
    expect(endpointMocks.options.queryOptions.refetchOnMount).toBe("always");
    expect(endpointMocks.options.realtime.matches({
      payload: {
        projectSlug: "project-b",
        reason: "session-action-run",
        sessionId: "session-a"
      }
    })).toBe(false);
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
      revision: 10,
      sessionId: "session-a"
    };
    endpointMocks.resource.isInitialLoading.value = false;
    endpointMocks.resource.isLoading.value = false;
    await nextTick();
    expect(controller.session.value.agentSession.turn.active).toBe(true);

    const successorPayload = {
      agentSession: {
        turn: {
          active: true,
          id: "turn-b",
          state: "active"
        }
      },
      reason: "codex-app-server-turn-active",
      revision: 11,
      sessionId: "session-a"
    };
    const turnListener = realtimeMocks.events.find((listener) => listener.matches({
      payload: successorPayload
    }));
    expect(turnListener).toBeTruthy();
    turnListener.onEvent({ payload: successorPayload });
    await nextTick();
    expect(controller.session.value.agentSession.turn).toMatchObject({
      active: true,
      id: "turn-b",
      state: "active"
    });
    expect(controller.session.value.revision).toBe(11);

    const completionPayload = {
      agentSession: {
        turn: {
          active: false,
          id: "turn-b",
          state: "idle"
        }
      },
      reason: "codex-app-server-turn-idle",
      revision: 12,
      sessionId: "session-a"
    };
    turnListener.onEvent({ payload: completionPayload });
    await nextTick();
    expect(controller.session.value.agentSession.turn).toMatchObject({
      active: false,
      id: "turn-b",
      state: "idle"
    });
    expect(controller.session.value.revision).toBe(12);

    realtimeMocks.socket.connected = true;
    realtimeMocks.handlers.get("connect")();
    await vi.waitFor(() => {
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });
    expect(endpointMocks.resource.query.refetch).toHaveBeenCalledTimes(1);
    expect(httpMocks.request).not.toHaveBeenCalled();

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
          method: "POST",
          signal: expect.any(AbortSignal)
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

  it("prepares the selected session provider at the connection boundary without a model turn", async () => {
    const scope = effectScope();
    const controller = scope.run(() => useVibe64MountedSessionData({
      active: ref(true),
      sessionId: ref("session-a"),
      sessionsApiPath: ref("/api/vibe64/sessions"),
      summarySession: ref(null)
    }));
    endpointMocks.resource.data.value = {
      agentSession: {
        turn: {
          active: false,
          state: "idle"
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
          method: "POST",
          signal: expect.any(AbortSignal)
        }
      );
    });
    await vi.waitFor(() => {
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });

    expect(httpMocks.request).toHaveBeenCalledTimes(1);
    expect(endpointMocks.resource.query.refetch).toHaveBeenCalledTimes(1);
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
    expect(controller.agentConnectionError.value).toBe("Provider unavailable.");

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

  describe("assistant status recovery", () => {
    let scope;
    let warnings;

    beforeEach(() => {
      vi.useFakeTimers();
      warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      scope?.stop();
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    function mountAssistant({ connect = true } = {}) {
      endpointMocks.resource.data.value = {
        agentSession: { turn: { active: true, id: "turn-a", state: "active" } },
        revision: 10,
        sessionId: "session-a"
      };
      scope = effectScope();
      const controller = scope.run(() => useVibe64MountedSessionData({
        active: ref(true),
        sessionId: ref("session-a"),
        sessionsApiPath: ref("/api/vibe64/sessions")
      }));
      if (connect) {
        realtimeMocks.socket.connected = true;
        realtimeMocks.handlers.get("connect")();
      }
      return controller;
    }

    it.each([false, true])("initializes quietly with socket connected=%s until the first check succeeds", async (connected) => {
      realtimeMocks.socket.connected = connected;
      const response = Promise.withResolvers();
      httpMocks.request.mockReturnValueOnce(response.promise);
      const controller = mountAssistant({ connect: false });
      expect(controller.agentConnectionStatus.value).toBe("initializing");
      if (!connected) {
        realtimeMocks.socket.connected = true;
        realtimeMocks.handlers.get("connect")();
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("initializing");
      expect(httpMocks.request).toHaveBeenCalledTimes(1);
      response.resolve({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });

    it("keeps recovery visible through a retry after an initial check fails", async () => {
      httpMocks.request.mockRejectedValueOnce(new Error("Temporary failure"));
      const response = Promise.withResolvers();
      httpMocks.request.mockReturnValueOnce(response.promise);
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("unknown");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(controller.agentConnectionStatus.value).toBe("reconciling");
      response.resolve({ ok: true });
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });

    it("shows recovery when the initial socket connection fails", () => {
      const controller = mountAssistant({ connect: false });
      expect(controller.agentConnectionStatus.value).toBe("initializing");
      realtimeMocks.handlers.get("connect_error")(new Error("Connection refused"));
      expect(controller.agentConnectionStatus.value).toBe("disconnected");
      expect(httpMocks.request).not.toHaveBeenCalled();
    });

    it.each([false, true])("waits for an account change when the AI connection is unavailable (HTTP error: %s)", async (httpError) => {
      const failure = { ok: false, code: "vibe64_assistant_connection_unavailable", error: "The selected AI connection is unavailable." };
      if (httpError) httpMocks.request.mockRejectedValueOnce(Object.assign(new Error(failure.error), { code: failure.code }));
      else httpMocks.request.mockResolvedValueOnce(failure);
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("unavailable");
      await vi.advanceTimersByTimeAsync(90_000);
      expect(httpMocks.request).toHaveBeenCalledTimes(1);
      const connectionEvent = realtimeMocks.events.find(({ event }) => event === "vibe64.connections.changed");
      connectionEvent.onEvent({ payload: { accountId: "codex", reason: "connected" } });
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
    });

    it.each([
      ["vibe64_agent_control_path_too_long", false],
      ["vibe64_agent_control_path_too_long", true],
      ["vibe64_agent_control_recovery_failed", false],
      ["vibe64_agent_control_recovery_failed", true],
      ["vibe64_codex_history_unsupported", false],
      ["vibe64_codex_history_unsupported", true]
    ])("keeps %s actionable until an explicit retry succeeds (HTTP error: %s)", async (code, httpError) => {
      const failure = {
        ok: false,
        code,
        error: code === "vibe64_agent_control_recovery_failed"
          ? "Assistant tool recovery could not be verified. Your conversation and work are preserved."
          : "The assistant cannot start. Ask the workspace administrator to shorten TMPDIR, then retry."
      };
      if (httpError) httpMocks.request.mockRejectedValueOnce(Object.assign(new Error(failure.error), { code: failure.code }));
      else httpMocks.request.mockResolvedValueOnce(failure);
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("failed");
      expect(controller.agentConnectionError.value).toBe(failure.error);
      await vi.advanceTimersByTimeAsync(90_000);
      expect(httpMocks.request).toHaveBeenCalledTimes(1);
      await controller.retryAgentConnection();
      expect(controller.agentConnectionStatus.value).toBe("connected");
      expect(controller.agentConnectionError.value).toBe("");
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
    });

    it("rechecks an account change that arrives during a failing status check", async () => {
      const response = Promise.withResolvers();
      httpMocks.request.mockReturnValueOnce(response.promise);
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      realtimeMocks.events.find(({ event }) => event === "vibe64.connections.changed").onEvent({});
      response.resolve({ ok: false, code: "vibe64_assistant_connection_unavailable" });
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
    });

    it.each([false, true])("immediately rechecks a model change after personal access is denied (check pending: %s)", async (pending) => {
      const response = Promise.withResolvers();
      httpMocks.request.mockReturnValueOnce(response.promise);
      const controller = mountAssistant();
      const failure = { ok: false, code: "vibe64_assistant_owner_required", error: "Only the owner can use this connection." };
      if (!pending) response.resolve(failure);
      await vi.advanceTimersByTimeAsync(0);
      if (!pending) {
        expect(controller.agentConnectionStatus.value).toBe("restricted");
        expect(controller.agentConnectionError.value).toBe("");
        await vi.advanceTimersByTimeAsync(90_000);
        expect(httpMocks.request).toHaveBeenCalledTimes(1);
        expect(warnings).not.toHaveBeenCalled();
      }
      // A background browser must recover without focus or the retry timer.
      vi.stubGlobal("document", { hidden: true, removeEventListener: vi.fn() });
      const payload = { projectSlug: "project-a", sessionId: "session-a", reason: "session-assistant-selection-updated", originId: "another-browser" };
      const selectionEvent = realtimeMocks.events.find(({ event, matches }) => (
        event === "vibe64.session.changed" && matches?.({ payload })
      ));
      expect(selectionEvent).toBeDefined();
      expect(selectionEvent.matches({ payload: { ...payload, projectSlug: "project-b" } })).toBe(false);
      expect(selectionEvent.matches({ payload: { ...payload, sessionId: "session-b" } })).toBe(false);
      expect(selectionEvent.matches({ payload: { ...payload, reason: "session-agent-turn-delta" } })).toBe(false);
      selectionEvent.onEvent({ payload });
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
      expect(controller.agentConnectionError.value).toBe("");
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
      response.resolve(failure);
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });

    it("manual recovery reconnects the socket or rechecks the existing connection", async () => {
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      realtimeMocks.socket.connected = false;
      realtimeMocks.handlers.get("disconnect")();
      await controller.retryAgentConnection();
      expect(realtimeMocks.socket.connect).toHaveBeenCalledTimes(1);
      expect(controller.agentConnectionStatus.value).toBe("disconnected");
      realtimeMocks.socket.connected = true;
      await controller.retryAgentConnection();
      expect(controller.agentConnectionStatus.value).toBe("connected");
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
      scope.stop();
      await controller.retryAgentConnection();
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
    });

    it("recovers from a busy response without reconnecting or losing the active turn", async () => {
      httpMocks.request.mockResolvedValueOnce({
        code: "vibe64_agent_write_mode_busy",
        error: "Another assistant operation is starting.",
        ok: false,
        retryable: true
      });
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("unknown");
      expect(controller.session.value.agentSession.turn.active).toBe(true);
      expect(warnings).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        code: "vibe64_agent_write_mode_busy",
        sessionId: "session-a"
      }));
      await vi.advanceTimersByTimeAsync(1_000);
      expect(controller.agentConnectionStatus.value).toBe("connected");
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
    });

    it.each([null, {}])("requires explicit provider success after an incomplete response: %j", async (result) => {
      httpMocks.request.mockResolvedValueOnce(result);
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("unknown");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(controller.agentConnectionStatus.value).toBe("connected");
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
    });

    it("backs off repeated network failures and recovers when requests work again", async () => {
      httpMocks.request.mockRejectedValue(new TypeError("Failed to fetch"));
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      for (const delay of [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
        const attempts = httpMocks.request.mock.calls.length;
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(httpMocks.request).toHaveBeenCalledTimes(attempts);
        await vi.advanceTimersByTimeAsync(1);
        expect(httpMocks.request).toHaveBeenCalledTimes(attempts + 1);
      }
      httpMocks.request.mockResolvedValue({ ok: true });
      await vi.advanceTimersByTimeAsync(30_000);
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });

    it("coalesces selection and connection checks in the same connection", async () => {
      const response = Promise.withResolvers();
      httpMocks.request.mockReturnValueOnce(response.promise);
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      const selected = controller.reconcileMountedAgentSession("selected");
      response.resolve({ ok: true });
      await selected;
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
      expect(httpMocks.request).toHaveBeenCalledTimes(1);
    });

    it("keeps verified status when the subsequent display refresh fails", async () => {
      endpointMocks.resource.query.refetch
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error("Display refresh failed"));
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(httpMocks.request).toHaveBeenCalledTimes(1);
    });

    it("retries failed query results instead of treating cached idle state as verified", async () => {
      endpointMocks.resource.query.refetch.mockResolvedValueOnce({
        error: new Error("Session read failed"),
        isError: true
      });
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("unknown");
      expect(httpMocks.request).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });

    it("times out a hung check and ignores its late failure after recovery", async () => {
      const response = Promise.withResolvers();
      httpMocks.request.mockReturnValueOnce(response.promise);
      const controller = mountAssistant();
      expect(controller.agentConnectionStatus.value).toBe("initializing");
      await vi.advanceTimersByTimeAsync(45_000);
      expect(controller.agentConnectionStatus.value).toBe("unknown");
      expect(httpMocks.request.mock.calls[0][1].signal.aborted).toBe(true);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(controller.agentConnectionStatus.value).toBe("connected");
      response.reject(new Error("Late failure"));
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });

    it("cancels an old connection check and verifies the new connection once", async () => {
      const response = Promise.withResolvers();
      httpMocks.request.mockReturnValueOnce(response.promise);
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      realtimeMocks.socket.connected = false;
      realtimeMocks.handlers.get("disconnect")();
      expect(controller.agentConnectionStatus.value).toBe("disconnected");
      realtimeMocks.socket.connected = true;
      realtimeMocks.handlers.get("connect")();
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
      response.resolve({ ok: false, error: "Old connection failed" });
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });

    it("stops retries when disconnected or disposed", async () => {
      httpMocks.request.mockRejectedValue(new Error("Offline"));
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      realtimeMocks.socket.connected = false;
      realtimeMocks.handlers.get("disconnect")();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(httpMocks.request).toHaveBeenCalledTimes(1);
      expect(controller.agentConnectionStatus.value).toBe("disconnected");
      realtimeMocks.socket.connected = true;
      realtimeMocks.handlers.get("connect")();
      await vi.advanceTimersByTimeAsync(0);
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
      scope.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
    });

    it("resumes recovery when a hidden browser becomes visible", async () => {
      const document = new EventTarget();
      document.hidden = true;
      vi.stubGlobal("document", document);
      httpMocks.request.mockRejectedValueOnce(new Error("Offline"));
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(httpMocks.request).toHaveBeenCalledTimes(1);
      document.hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
      expect(httpMocks.request).toHaveBeenCalledTimes(2);
    });

    it("pauses a scheduled retry if the browser becomes hidden", async () => {
      const document = new EventTarget();
      document.hidden = false;
      vi.stubGlobal("document", document);
      httpMocks.request.mockRejectedValueOnce(new Error("Offline"));
      const controller = mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      document.hidden = true;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(httpMocks.request).toHaveBeenCalledTimes(1);
      document.hidden = false;
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(controller.agentConnectionStatus.value).toBe("connected");
    });

    it("does not start provider work after disposal during the initial read", async () => {
      const response = Promise.withResolvers();
      endpointMocks.resource.query.refetch.mockReturnValueOnce(response.promise);
      mountAssistant();
      await vi.advanceTimersByTimeAsync(0);
      scope.stop();
      response.resolve(null);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(httpMocks.request).not.toHaveBeenCalled();
    });
  });
});
