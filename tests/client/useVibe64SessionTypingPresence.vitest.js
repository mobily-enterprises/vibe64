import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const realtimeHarness = vi.hoisted(() => {
  const listeners = new Map();
  return {
    eventOptions: null,
    listeners,
    reset() {
      this.eventOptions = null;
      listeners.clear();
    },
    socket: {
      off(event, handler) {
        listeners.get(event)?.delete(handler);
      },
      on(event, handler) {
        const handlers = listeners.get(event) || new Set();
        handlers.add(handler);
        listeners.set(event, handlers);
      }
    }
  };
});

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    realtimeHarness.eventOptions = options;
    return { active: ref(true) };
  },
  useRealtimeSocket() {
    return realtimeHarness.socket;
  }
}));

import {
  normalizedRemotePresence,
  sessionPresencePath,
  typingPresenceLabel,
  useVibe64SessionTypingPresence
} from "../../src/composables/useVibe64SessionTypingPresence.js";
import {
  VIBE64_SESSION_PRESENCE_CHANGED_EVENT,
  VIBE64_SESSION_PRESENCE_DEBOUNCE_MS,
  VIBE64_SESSION_PRESENCE_IDLE_MS
} from "@local/vibe64-runtime/shared";

function createPresence(overrides = {}, dependencies = {}) {
  const state = {
    active: ref(true),
    projectSlug: ref("beepollen"),
    sessionId: ref("session-1"),
    sessionsApiPath: ref("/api/vibe64/sessions"),
    ...overrides
  };
  const request = dependencies.request || vi.fn(async () => ({ ok: true }));
  const scope = effectScope();
  const presence = scope.run(() => useVibe64SessionTypingPresence(state, {
    ...dependencies,
    request
  }));
  return { presence, request, scope, state };
}

function remotePayload(overrides = {}) {
  return {
    actorId: "member-1",
    displayName: "John",
    expiresAt: new Date(Date.now() + VIBE64_SESSION_PRESENCE_IDLE_MS).toISOString(),
    originId: "remote-tab-1",
    projectSlug: "beepollen",
    sequence: 1,
    sessionId: "session-1",
    typing: true,
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function emitPresence(payload) {
  realtimeHarness.eventOptions.onEvent({ payload });
}

describe("useVibe64SessionTypingPresence", () => {
  beforeEach(() => {
    realtimeHarness.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T02:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the existing session route and realtime event contract", () => {
    const { scope } = createPresence();
    expect(sessionPresencePath("/api/vibe64/sessions", "session-1")).toBe(
      "/api/vibe64/sessions/session-1/presence"
    );
    expect(realtimeHarness.eventOptions.event).toBe(VIBE64_SESSION_PRESENCE_CHANGED_EVENT);
    expect(realtimeHarness.eventOptions.enabled.value).toBe(true);
    scope.stop();
  });

  it("coalesces typing into five-second updates without idle heartbeats or draft text", async () => {
    const { presence, request, scope } = createPresence();
    for (let second = 0; second < 5; second++) {
      for (let key = 0; key < 20; key++) presence.noteInputActivity();
      expect(request).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual([
      "/api/vibe64/sessions/session-1/presence", {
        body: { originId: expect.stringMatching(/^tab:/u), sequence: expect.any(Number), typing: true },
        method: "POST", timeoutMs: 5_000
      }
    ]);
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("draft");
    const sequence = request.mock.calls[0][1].body.sequence;
    for (let second = 0; second < 5; second++) {
      presence.noteInputActivity();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1].body.sequence).toBe(sequence + 1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(2);
    scope.stop();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("blur, submit, session switch and disposal cancel pending updates without requests", async () => {
    const { presence, request, scope, state } = createPresence();
    for (const stop of [presence.blur, presence.submit, () => { state.sessionId.value = "session-2"; }, () => scope.stop()]) {
      presence.noteInputActivity();
      await vi.advanceTimersByTimeAsync(4_999);
      stop();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(request).not.toHaveBeenCalled();
    }
  });

  it("does not overlap slow presence calls", async () => {
    let resolve;
    const request = vi.fn(() => new Promise(done => { resolve = done; }));
    const { presence, scope } = createPresence({}, { request });
    presence.noteInputActivity();
    await vi.advanceTimersByTimeAsync(5_000);
    for (let second = 0; second < 20; second++) {
      presence.noteInputActivity();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(request).toHaveBeenCalledTimes(1);
    resolve({ ok: true });
    await vi.advanceTimersByTimeAsync(0);
    scope.stop();
  });

  it("aggregates origins by actor, suppresses self, filters scope, and ignores stale expiry", async () => {
    const { presence, request, scope } = createPresence();
    emitPresence(remotePayload());
    emitPresence(remotePayload({ originId: "remote-tab-2", sequence: 2 }));
    expect(presence.typingPeople.value).toEqual([{
      actorId: "member-1",
      displayName: "John"
    }]);
    expect(presence.typingLabel.value).toBe("John is typing…");

    emitPresence(remotePayload({
      actorId: "member-2",
      displayName: "Mary",
      originId: "remote-tab-3"
    }));
    expect(presence.typingLabel.value).toBe("2 people are typing…");

    emitPresence(remotePayload({
      originId: "remote-tab-2",
      sequence: 1,
      typing: false
    }));
    expect(presence.typingPeople.value).toHaveLength(2);
    emitPresence(remotePayload({
      originId: "remote-tab-2",
      sequence: 2,
      typing: false,
      updatedAt: new Date(Date.now() + 1).toISOString()
    }));
    expect(presence.typingPeople.value).toHaveLength(2);

    emitPresence(remotePayload({ projectSlug: "other-project" }));
    emitPresence(remotePayload({ sessionId: "other-session" }));
    presence.noteInputActivity();
    await vi.advanceTimersByTimeAsync(VIBE64_SESSION_PRESENCE_DEBOUNCE_MS);
    emitPresence(remotePayload({
      actorId: "self",
      displayName: "Self",
      originId: request.mock.calls[0][1].body.originId
    }));
    expect(presence.typingPeople.value).toHaveLength(2);
    scope.stop();
  });

  it("keeps a short idle tombstone so a delayed older true cannot resurrect typing", () => {
    const { presence, scope } = createPresence();
    emitPresence(remotePayload({ sequence: 3, typing: false }));
    emitPresence(remotePayload({ sequence: 2, typing: true }));

    expect(presence.typingPeople.value).toEqual([]);
    expect(presence.typingLabel.value).toBe("");
    scope.stop();
  });

  it("isolates Main and temporary chats and clears the old chat when switching", async () => {
    const conversationId = ref("temporary-one");
    const { presence, request, scope } = createPresence({ conversationId });
    emitPresence(remotePayload());
    emitPresence(remotePayload({ conversationId: "temporary-two" }));
    expect(presence.typingLabel.value).toBe("");
    emitPresence(remotePayload({ conversationId: "temporary-one" }));
    expect(presence.typingLabel.value).toBe("John is typing…");

    presence.noteInputActivity();
    await vi.advanceTimersByTimeAsync(VIBE64_SESSION_PRESENCE_DEBOUNCE_MS);
    expect(request.mock.calls.at(-1)[1].body).toMatchObject({ conversationId: "temporary-one", typing: true });
    conversationId.value = "temporary-two";
    expect(request.mock.calls.at(-1)[1].body).toMatchObject({ conversationId: "temporary-one", typing: true });
    expect(presence.typingLabel.value).toBe("");
    emitPresence(remotePayload({ conversationId: "temporary-one", sequence: 3 }));
    expect(presence.typingLabel.value).toBe("");
    presence.noteInputActivity();
    await vi.advanceTimersByTimeAsync(VIBE64_SESSION_PRESENCE_DEBOUNCE_MS);
    expect(request.mock.calls.at(-1)[1].body).toMatchObject({ conversationId: "temporary-two", typing: true });
    scope.stop();
    expect(request.mock.calls.at(-1)[1].body).toMatchObject({ conversationId: "temporary-two", typing: true });

    const main = createPresence();
    emitPresence(remotePayload({ conversationId: "temporary-one" }));
    expect(main.presence.typingLabel.value).toBe("");
    emitPresence(remotePayload());
    expect(main.presence.typingLabel.value).toBe("John is typing…");
    main.scope.stop();
  });

  it("clears remote people on disconnect without a request on reconnect", async () => {
    const { presence, request, scope } = createPresence();
    presence.noteInputActivity();
    await vi.advanceTimersByTimeAsync(VIBE64_SESSION_PRESENCE_DEBOUNCE_MS);
    const firstSequence = request.mock.calls.at(-1)[1].body.sequence;
    emitPresence(remotePayload());
    expect(presence.typingPeople.value).toHaveLength(1);

    for (const handler of realtimeHarness.listeners.get("disconnect") || []) {
      handler();
    }
    expect(presence.typingPeople.value).toHaveLength(0);
    for (const handler of realtimeHarness.listeners.get("connect") || []) {
      handler();
    }
    expect(request.mock.calls.at(-1)[1].body).toMatchObject({
      sequence: firstSequence,
      typing: true
    });
    scope.stop();
  });

  it("normalizes safe display labels and expires locally", async () => {
    expect(typingPresenceLabel([{ displayName: "" }])).toBe("Another user is typing…");
    expect(typingPresenceLabel([{}, {}])).toBe("2 people are typing…");
    expect(normalizedRemotePresence(remotePayload())?.displayName).toBe("John");
    expect(normalizedRemotePresence(remotePayload({
      expiresAt: new Date().toISOString()
    }))?.typing).toBe(false);

    const { presence, scope } = createPresence();
    emitPresence(remotePayload());
    expect(presence.typingLabel.value).toBe("John is typing…");
    await vi.advanceTimersByTimeAsync(VIBE64_SESSION_PRESENCE_IDLE_MS);
    await nextTick();
    expect(presence.typingLabel.value).toBe("");
    scope.stop();
  });
});
