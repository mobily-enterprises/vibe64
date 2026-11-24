import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

import { agentMessageInputValidator } from "../../packages/vibe64-sessions/src/server/inputSchemas.js";
import { agentTurnControlPayloadFromContext } from "../../src/lib/vibe64SessionRequestConfig.js";
import {
  focusRuntimeSessionChat,
  proxySessionDialogs,
  runtimeHostAgentWorking,
  runtimeHostToolbarSessions,
  runtimeHostWorkInspectionRevision,
  runtimeHostWorkTaskRevision,
  runtimeHostWorkTaskState
} from "../../src/composables/useVibe64SessionRuntimeHost.js";

describe("Vibe64 direct session runtime host", () => {
  it("keeps browser route selection local instead of hydrating or broadcasting it", () => {
    const source = readFileSync(new URL(
      "../../src/composables/useVibe64SessionRuntimeHost.js",
      import.meta.url
    ), "utf8");

    expect(source).not.toContain("useVibe64SessionViewSync");
    expect(source).not.toContain("uiSync");
  });

  it("settles message acceptance before background session reconciliation", () => {
    const source = readFileSync(new URL(
      "../../src/composables/useVibe64SessionRuntimeHost.js",
      import.meta.url
    ), "utf8");

    const conversationSource = readFileSync(new URL(
      "../../src/composables/useVibe64ConversationRuntime.js",
      import.meta.url
    ), "utf8");

    expect(source).toContain(
      "return conversationRuntime.value?.sendAgentMessage(input) ?? false;"
    );
    expect(conversationSource).toContain(
      'void mounted.refresh({ reason: "agent-message-accepted" }).catch(() => {});'
    );
    expect(conversationSource).not.toContain(
      'await mounted.refresh({ reason: "agent-message-accepted" })'
    );
  });

  it("places focus in the newly selected renewed session after it mounts", async () => {
    const focus = vi.fn();
    const target = { focus };
    const runtime = {
      getAttribute: () => "session-fresh",
      querySelector: vi.fn(() => target)
    };
    const root = {
      querySelectorAll: vi.fn(() => [runtime])
    };

    await expect(focusRuntimeSessionChat("session-fresh", root)).resolves.toBe(true);
    expect(runtime.querySelector).toHaveBeenCalledWith(".studio-autopilot__chat-panel");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("tracks every repository background task instead of only the oldest one", () => {
    const checkpoint = {
      events: [{ at: "2026-08-21T09:00:00.000Z", kind: "checkpoint-confirmed", status: "ready" }],
      id: "codex_turn_checkpoint",
      status: "ready",
      updatedAt: "2026-08-21T09:00:00.000Z"
    };
    const running = runtimeHostWorkTaskRevision({
      backgroundTasks: [
        checkpoint,
        {
          events: [{ at: "2026-08-21T09:26:37.991Z", kind: "reconcile", status: "running" }],
          id: "save-work",
          status: "running",
          updatedAt: "2026-08-21T09:26:37.991Z"
        }
      ]
    });
    const ready = runtimeHostWorkTaskRevision({
      backgroundTasks: [
        checkpoint,
        {
          events: [{ at: "2026-08-21T09:26:55.716Z", kind: "saved", status: "ready" }],
          id: "save-work",
          status: "ready",
          updatedAt: "2026-08-21T09:26:55.716Z"
        }
      ]
    });

    expect(ready).not.toBe(running);
  });

  it("inspects files when an operation starts, is replaced or ends, not at each progress event", () => {
    const update = (status, operationId, events) => ({ backgroundTasks: [{
      events: events.map((kind, index) => ({ at: `2026-10-19T01:22:0${index}.000Z`, kind, status })),
      id: "update-session", operationId, status, updatedAt: `2026-10-19T01:22:0${events.length}.000Z`
    }] });
    const started = update("running", "update-a", ["started"]);
    const rebased = update("running", "update-a", ["started", "rebased", "verified"]);
    expect(runtimeHostWorkTaskRevision(rebased), "progress is still displayed").not.toBe(runtimeHostWorkTaskRevision(started));
    expect(runtimeHostWorkInspectionRevision(rebased)).toBe(runtimeHostWorkInspectionRevision(started));
    for (const changed of [
      update("running", "update-b", ["started"]),
      update("ready", "update-a", ["started", "rebased", "verified", "updated"]),
      update("failed", "update-a", ["started", "rebased", "failed"]),
      { backgroundTasks: [] }
    ]) {
      expect(runtimeHostWorkInspectionRevision(changed)).not.toBe(runtimeHostWorkInspectionRevision(started));
    }
    const checkpoint = (at) => ({ events: [{ at, kind: "checkpoint-confirmed", status: "running" }],
      id: "codex_turn_checkpoint", status: "running", updatedAt: at });
    const withCheckpoint = (at) => ({ backgroundTasks: [...started.backgroundTasks, checkpoint(at)] });
    expect(runtimeHostWorkInspectionRevision(withCheckpoint("2026-10-19T01:23:00.000Z")),
      "agent checkpoints still change files").not.toBe(runtimeHostWorkInspectionRevision(withCheckpoint("2026-10-19T01:24:00.000Z")));
  });

  it("projects realtime Save progress without waiting for repository inspection", () => {
    const runningSave = {
      events: [{ at: "2026-09-01T14:27:04.127Z", kind: "canonical", status: "running" }],
      id: "save-work",
      operationId: "save-operation",
      status: "running",
      updatedAt: "2026-09-01T14:27:04.127Z"
    };

    expect(runtimeHostWorkTaskState({ backgroundTasks: [runningSave] })).toEqual({
      activeOperation: { kind: "save", operationId: "save-operation" },
      operation: runningSave,
      updateOperation: null
    });
    expect(runtimeHostWorkTaskState({
      backgroundTasks: [{
        ...runningSave,
        events: [...runningSave.events, {
          at: "2026-09-01T14:28:40.503Z",
          kind: "saved",
          status: "ready"
        }],
        status: "ready",
        updatedAt: "2026-09-01T14:28:40.503Z"
      }]
    })).toMatchObject({
      activeOperation: null,
      operation: { status: "ready" },
      updateOperation: null
    });
  });

  it("projects only the supplied direct-session dialogs", () => {
    const dialogs = proxySessionDialogs({
      archive: { open: true }
    });

    expect(Object.keys(dialogs)).toEqual(["archive"]);
    expect(dialogs.archive.open).toBe(true);
  });

  it("uses the provider turn projection as visible assistant activity", () => {
    expect(runtimeHostAgentWorking({
      selectedSession: {
        agentSession: { turn: { active: true } },
        sessionId: "session-a"
      }
    })).toBe(true);
    expect(runtimeHostAgentWorking({
      selectedSession: {
        agentSession: { turn: { active: false } },
        sessionId: "session-a"
      }
    })).toBe(false);
    expect(runtimeHostAgentWorking({
      selectedSession: {
        agentSession: { turn: { active: false } },
        sessionId: "session-a"
      },
      transientAgentThinking: true
    })).toBe(true);
  });

  it("forwards active composer work into the toolbar thinking state", () => {
    const runtimeHostSource = readFileSync(new URL(
      "../../src/composables/useVibe64SessionRuntimeHost.js",
      import.meta.url
    ), "utf8");
    const autopilotSource = readFileSync(new URL(
      "../../src/composables/useVibe64AutopilotView.js",
      import.meta.url
    ), "utf8");

    expect(runtimeHostSource).toContain("setAutopilotBusy,");
    expect(runtimeHostSource).toContain("transientAgentThinking: autopilotAgentThinking.value");
    expect(autopilotSource).toMatch(/agentActive\.value\s*\|\|\s*composerSending\.value/u);
  });

  it("keeps other sessions' live activity when updating the selected toolbar session", () => {
    expect(runtimeHostToolbarSessions({
      activeAgentThinking: true,
      selectedSession: { sessionId: "session-a" },
      selectedSessionId: "session-a",
      sessions: [
        { sessionId: "session-a", sessionName: "Alpha" },
        { agentThinking: true, sessionId: "session-b", sessionName: "Beta" }
      ]
    })).toEqual([
      { agentThinking: true, sessionId: "session-a", sessionName: "Alpha" },
      { agentThinking: true, sessionId: "session-b", sessionName: "Beta" }
    ]);
  });

  it("clears the pulse when background work finishes without selecting that session", () => {
    const background = { agentThinking: true, sessionId: "session-b" };
    const input = {
      selectedSessionId: "session-a",
      selectedSession: { sessionId: "session-a" },
      sessions: [{ agentThinking: true, sessionId: "session-a" }, background]
    };
    expect(runtimeHostToolbarSessions(input).map((session) => session.agentThinking)).toEqual([false, true]);

    background.agentThinking = false;
    expect(runtimeHostToolbarSessions(input).map((session) => session.agentThinking)).toEqual([false, false]);
  });

  it("builds schema-valid assistant message and interrupt payloads", () => {
    const message = agentTurnControlPayloadFromContext({
      displayMessage: "Especially the drying part",
      message: "Especially the drying part",
      messageId: "message:test",
      sessionId: "session-a"
    });
    expect(message).toMatchObject({
      displayMessage: "Especially the drying part",
      message: "Especially the drying part",
      messageId: "message:test"
    });
    expect(message.originId).toMatch(/^tab:/u);
    expect(() => validateSchemaPayload(agentMessageInputValidator, message, {
      context: "agent message request contract"
    })).not.toThrow();
    expect(() => validateSchemaPayload(agentMessageInputValidator, {
      ...message,
      genesisTask: "deslop"
    }, {
      context: "explicit Deslop message request contract"
    })).not.toThrow();
    expect(() => validateSchemaPayload(agentMessageInputValidator, {
      ...message,
      genesisTask: "ui-pass"
    }, {
      context: "explicit UI pass message request contract"
    })).not.toThrow();
    expect(() => validateSchemaPayload(agentMessageInputValidator, {
      ...message,
      genesisTask: "quality-pass"
    }, {
      context: "a pass from the Passes list"
    })).not.toThrow();
    expect(() => validateSchemaPayload(agentMessageInputValidator, {
      ...message,
      genesisTask: "../Quality"
    }, {
      context: "a Genesis task that is not a pass id"
    })).toThrow();

    expect(agentTurnControlPayloadFromContext({
      reason: "user_interrupt",
      sessionId: "session-a"
    })).toMatchObject({
      reason: "user_interrupt"
    });
  });
});

describe("session navigation projections", () => {
  it("keeps an explicitly empty navigation view empty while background work remains active", () => {
    const sessions = [
      { sessionId: "working", agentThinking: true },
      { sessionId: "learning", agentThinking: false }
    ];
    expect(runtimeHostToolbarSessions({
      activeAgentThinking: true,
      fallbackSessions: sessions,
      selectedSession: { sessionId: "working", agentSession: { turn: { active: true } } },
      selectedSessionId: "working",
      sessions: []
    })).toEqual([]);
    expect(sessions).toEqual([
      { sessionId: "working", agentThinking: true },
      { sessionId: "learning", agentThinking: false }
    ]);
  });

  it("uses the authoritative list only when a navigation projection is absent", () => {
    const input = {
      fallbackSessions: [{ sessionId: "working" }],
      selectedSession: { sessionId: "working", agentSession: { turn: { active: true } } },
      selectedSessionId: "working"
    };
    expect(runtimeHostToolbarSessions(input)).toEqual([{ sessionId: "working", agentThinking: true }]);
    expect(runtimeHostToolbarSessions({ ...input, sessions: null })).toEqual([
      { sessionId: "working", agentThinking: true }
    ]);
    expect(runtimeHostToolbarSessions({ ...input, sessions: [{ sessionId: "learning" }] })).toEqual([
      { sessionId: "learning" }
    ]);
  });
});

// Exercise the original host constructor; the shared transport's own retained
// binding, admission and account fences have their original separate fixtures.
import { computed, createRenderer, h, reactive, ref, shallowRef, toValue, nextTick } from "vue";
import { useVibe64SessionRuntimeHost } from "../../src/composables/useVibe64SessionRuntimeHost.js";
import { useVibe64SessionRepositoryStatusRegistry } from "../../src/composables/useVibe64SessionRepositoryStatusRegistry.js";
const mountedHostMocks = vi.hoisted(() => ({
  conversation: vi.fn(), renewal: vi.fn(), request: vi.fn(), events: vi.fn(),
  socket: { connected: false, emit() {}, off() {}, on() {} }
}));
vi.mock("../../src/composables/useVibe64ConversationRuntime.js", () => ({
  useVibe64ConversationRuntime: mountedHostMocks.conversation
}));
vi.mock("../../src/composables/useVibe64SessionRenewal.js", () => ({
  useVibe64SessionRenewal: mountedHostMocks.renewal
}));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent: mountedHostMocks.events,
  useRealtimeSocket: () => mountedHostMocks.socket
}));
vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient: () => ({ request: mountedHostMocks.request })
}));
vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({
  useUiFeedback: () => ({ success: vi.fn(), error: vi.fn() })
}));
const mountedHostRenderer = createRenderer({
  createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
  setElementText() {}, setText() {}, insert() {}, remove() {}, patchProp() {},
  parentNode() {}, nextSibling() {}
});
function mountedHostFixture() {
  const session = { sessionId: "working-one", agentSession: { turn: {} } };
  const state = reactive({ sessions: [session], apiPath: "/api/projects/one/vibe64/sessions" });
  const props = reactive({ active: true, sessionId: session.sessionId, projectContext: { slug: "one" } });
  // Props in the actual component are shallow: preserve the same ref contract.
  const hostProps = { get active() { return props.active; }, get sessionId() { return props.sessionId; },
    get projectContext() { return props.projectContext; }, sessionData: {
      sessions: computed(() => state.sessions),
      sessionsApiPath: computed(() => state.apiPath),
      sessionList: reactive({ loadError: "" }),
      shortSessionId: id => id, refreshSessionData: vi.fn(async () => {}),
      canCreateSession: true, createSessionVisible: true,
      archive: { command: { isRunning: false }, request: vi.fn() }
    } };
  mountedHostMocks.conversation.mockClear(); mountedHostMocks.renewal.mockClear();
  mountedHostMocks.request.mockClear(); mountedHostMocks.events.mockClear();
  const send = vi.fn(async () => true);
  const mountedSession = ref(session);
  mountedHostMocks.conversation.mockImplementation(() => shallowRef({
    mounted: { session: mountedSession, detailState: ref({}), agentConnectionError: ref(""),
      agentConnectionStatus: ref("connected"), refresh: vi.fn(async () => {}) }, sendAgentMessage: send
  }));
  mountedHostMocks.renewal.mockImplementation(() => ({ sourceOperationsSuspended: ref(false) }));
  mountedHostMocks.request.mockResolvedValue({ ok: true, unsaved: false });
  let host;
  const app = mountedHostRenderer.createApp({ setup() {
    // The session panel's repository status registry inspects this session's work.
    hostProps.sessionWorkInspector = useVibe64SessionRepositoryStatusRegistry({
      selectedSessionId: () => props.sessionId,
      sessions: computed(() => state.sessions),
      sessionsApiPath: computed(() => state.apiPath)
    }).sessionWork;
    host = useVibe64SessionRuntimeHost(hostProps, vi.fn()); return () => h("div");
  } });
  app.mount({});
  return { app, host, mountedSession, props, hostProps, state, send };
}

describe("mounted Main host", () => {
  it("forwards the reviewed destination through the existing Save endpoint", async () => {
    const f = mountedHostFixture();
    try {
      const destinationReview = { sessionId: "working-one", mode: "github", repository: "example/app", branch: "main" };
      await f.host.saveSessionWork({ destinationReview });
      const save = mountedHostMocks.request.mock.calls.find(([url]) => url.endsWith("/working-one/save"));
      expect(save).toBeTruthy();
      expect(save[1].body).toMatchObject({ destinationReview });
      expect(save[1].body).not.toHaveProperty("connectedReview");
      expect(save[1].method).toBe("POST");
    } finally { f.app.unmount(); }
  });

  it("preserves original reactive Working targets and source facilities", async () => {
    const f = mountedHostFixture();
    try {
      const captured = mountedHostMocks.conversation.mock.calls[0][0];
      expect(toValue(captured.projectSlug)).toBe("one");
      expect(toValue(captured.sessionsApiPath)).toBe("/api/projects/one/vibe64/sessions");
      f.props.projectContext = { slug: "two" }; f.state.apiPath = "/api/projects/two/vibe64/sessions";
      await nextTick();
      expect(toValue(captured.projectSlug)).toBe("two");
      expect(toValue(captured.sessionsApiPath)).toBe("/api/projects/two/vibe64/sessions");
      expect(f.host.autopilotSessionToolbar.canCreateSession).toBe(true);
      expect(f.host.codexTerminalCanStart.value).toBe(true);
      await f.host.refreshWorkState();
      expect(mountedHostMocks.request.mock.calls.some(([path]) => path === "/api/projects/two/vibe64/sessions/working-one/work")).toBe(true);
    } finally { f.app.unmount(); }
  });
});


describe("host work inspection", () => {
  // A session change reaches both the registry and this host (through the
  // change's task revision); the session's work is read once for both.
  it("reuses the registry's inspection of its session instead of reading it again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const f = mountedHostFixture();
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      const workReads = () => mountedHostMocks.request.mock.calls.filter(([path]) => path.endsWith("/working-one/work"));
      expect(workReads().length).toBeGreaterThan(0);
      mountedHostMocks.request.mockClear();
      mountedHostMocks.request.mockResolvedValue({ ok: true, changedPaths: ["src/app.js"], unsaved: true });
      const listener = (event) => mountedHostMocks.events.mock.calls.map(([options]) => options)
        .find((options) => options.event === event);
      const sessionChanged = listener("vibe64.session.summary.changed");
      const checkpoint = { reason: "session-turn-checkpoint-updated", sessionId: "working-one" };
      expect(sessionChanged.matches({ payload: checkpoint })).toBe(true);
      sessionChanged.onEvent({ payload: checkpoint });
      // The host's own detail refresh then shows the same checkpoint's task.
      f.mountedSession.value = { ...f.mountedSession.value, backgroundTasks: [{
        events: [{ at: "2026-10-29T08:44:30.000Z", kind: "checkpoint-created" }],
        id: "codex_turn_checkpoint", status: "ready", updatedAt: "2026-10-29T08:44:30.000Z"
      }] };
      await vi.advanceTimersByTimeAsync(300);
      sessionChanged.onEvent({ payload: { reason: "claude-stream-turn-idle", sessionId: "working-one" } });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(workReads()).toHaveLength(1);
      expect(f.host.workState.value).toMatchObject({ changedPaths: ["src/app.js"], loading: false, unsaved: true });

      // An inspection only the registry asked for still reaches this host.
      mountedHostMocks.request.mockResolvedValue({ ok: true, changedPaths: [], unsaved: false });
      listener("vibe64.source-editor.file.changed").onEvent({ payload: { sessionId: "working-one" } });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(workReads()).toHaveLength(2);
      expect(f.host.workState.value).toMatchObject({ changedPaths: [], unsaved: false });
    } finally {
      f.app.unmount();
      vi.useRealTimers();
    }
  });
});

describe("host list errors", () => {
  it("shows the session list load error on the guarded page", () => {
    const f = mountedHostFixture();
    try {
      expect(f.host.guardedPage.value.error).toBe("");
      f.hostProps.sessionData.sessionList.loadError = "Sessions unavailable";
      expect(f.host.guardedPage.value.error).toBe("Sessions unavailable");
    } finally { f.app.unmount(); }
  });
});

// Save and Update answer their request once the work starts, and run on at the server (on 24 Nov 2026 a hosted
// Update answered "Request failed with status 504." after the edge's minute, while it went on updating). The host
// follows the work's task to the outcome its request used to wait for.
describe("host Save and Update answered once they start", () => {
  const SAVE_STARTED = "2026-11-24T03:38:00.000Z";

  /** The session's Save and Update tasks as its detail and its work inspection both show them. */
  function hostWorkServer(f, answers) {
    const tasks = { "save-work": null, "update-session": null };
    mountedHostMocks.request.mockImplementation(async (path) => {
      if (path.endsWith("/work")) {
        const active = Object.values(tasks).find((task) => task?.status === "running");
        return { ok: true, sessionId: "working-one", unsaved: false, operation: tasks["save-work"],
          updateOperation: tasks["update-session"],
          activeOperation: active ? { kind: active.id === "save-work" ? "save" : "update", operationId: active.operationId } : null };
      }
      const answer = Object.entries(answers).find(([suffix]) => path.endsWith(suffix))?.[1];
      // The repository status registry checks the session for updates as it opens.
      if (!answer) return path.endsWith("/updates/check") ? { ok: true, updateAvailable: true } : { ok: true };
      return typeof answer === "function" ? answer() : answer;
    });
    return {
      requests: (suffix) => mountedHostMocks.request.mock.calls.filter(([path]) => path.endsWith(suffix)),
      async show(task) {
        tasks[task.id] = task;
        f.mountedSession.value = { ...f.mountedSession.value, backgroundTasks: Object.values(tasks).filter(Boolean) };
        await settle();
      }
    };
  }

  async function settle() {
    for (let turn = 0; turn < 5; turn += 1) {
      await nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  function tracked(promise) {
    const state = { done: false };
    state.result = promise.then((value) => { state.done = true; return value; },
      (error) => { state.done = true; throw error; });
    // The test's own expectation reads the rejection; until then it is not unhandled.
    state.result.catch(() => {});
    return state;
  }

  const running = (id, operationId, startedAt = SAVE_STARTED) => ({
    events: [{ kind: id === "save-work" ? "save-started" : "update-started", status: "running" }],
    id, operationId, startedAt, status: "running"
  });

  it("follows a started Update past an earlier one's outcome to its own, with the update check it recorded", async () => {
    const f = mountedHostFixture();
    const server = hostWorkServer(f, {
      "/updates/apply": { ok: true, operation: running("update-session", "update-2"), operationId: "update-2", running: true },
      "/updates/check": { ok: true, behind: 0, checkedAt: "2026-11-24T03:40:00.000Z", updateAvailable: false }
    });
    try {
      await settle();
      await server.show({ id: "update-session", operationId: "update-1", startedAt: "2026-11-23T09:00:00.000Z", status: "ready" });
      const update = tracked(f.host.updateSessionWork());
      await settle();
      expect(update.done).toBe(false);
      await server.show({ ...running("update-session", "update-2"), events: [
        { kind: "update-started", status: "running" },
        { kind: "connected", message: "genesis-compiler updated to 5c179f06d770.", status: "running" }
      ] });
      expect(update.done).toBe(false);
      const checks = server.requests("/updates/check").length;
      await server.show({ ...running("update-session", "update-2"), status: "ready", updatedPathCount: 2 });
      await expect(update.result).resolves.toMatchObject({
        ok: true, behind: 0, checkedAt: "2026-11-24T03:40:00.000Z", operation: { operationId: "update-2", status: "ready" },
        updateAvailable: false, updatedPathCount: 2
      });
      expect(server.requests("/updates/apply")).toHaveLength(1);
      // The check the finished Update recorded, read unforced as its waited-for answer carried it.
      expect(server.requests("/updates/check").slice(checks).map(([, options]) => options.body)).toContainEqual({ force: false });
    } finally { f.app.unmount(); }
  });

  it("throws a started Update's conflict as its request did, with the recovery its notice offers", async () => {
    const f = mountedHostFixture();
    const server = hostWorkServer(f, {
      "/updates/apply": { ok: true, operation: running("update-session", "update-2"), operationId: "update-2", running: true }
    });
    try {
      const update = tracked(f.host.updateSessionWork());
      await settle();
      const conflictRecovery = { conflictPaths: ["src/app.js"], connectedRepository: "genesis-compiler", reviewId: "review-1" };
      await server.show({ ...running("update-session", "update-2"), code: "vibe64_session_update_conflict",
        conflictPaths: ["src/app.js"], conflictRecovery, connectedRepository: "genesis-compiler",
        error: "genesis-compiler has conflicts to review.", status: "failed" });
      await expect(update.result).rejects.toMatchObject({
        code: "vibe64_session_update_conflict",
        details: { conflictPaths: ["src/app.js"], conflictRecovery, connectedRepository: "genesis-compiler" },
        message: "genesis-compiler has conflicts to review."
      });
    } finally { f.app.unmount(); }
  });

  it("follows the Update an edge's 504 hid, through the operation the session reports running", async () => {
    const f = mountedHostFixture();
    const server = hostWorkServer(f, {
      "/updates/apply": async () => {
        // The Update started before its answer was lost.
        await server.show(running("update-session", "update-3"));
        throw Object.assign(new Error("Request failed with status 504."), { status: 504 });
      },
      "/updates/check": { ok: true, updateAvailable: false }
    });
    try {
      const update = tracked(f.host.updateSessionWork());
      await settle();
      expect(update.done).toBe(false);
      await server.show({ ...running("update-session", "update-3"), status: "ready" });
      await expect(update.result).resolves.toMatchObject({ ok: true, operation: { operationId: "update-3" } });
    } finally { f.app.unmount(); }
  });

  it("still reports a lost answer when no Update started", async () => {
    const f = mountedHostFixture();
    hostWorkServer(f, {
      "/updates/apply": async () => { throw Object.assign(new Error("Request failed with status 504."), { status: 504 }); }
    });
    try {
      await expect(f.host.updateSessionWork()).rejects.toMatchObject({ message: "Request failed with status 504.", status: 504 });
    } finally { f.app.unmount(); }
  });

  it("refuses a started Save that found the session needs an Update first, as its request did", async () => {
    const f = mountedHostFixture();
    const server = hostWorkServer(f, {
      "/save": { ok: true, operation: running("save-work", "save-2"), operationId: "save-2", running: true }
    });
    try {
      const save = tracked(f.host.saveSessionWork({ destinationReview: { sessionId: "working-one" } }));
      await settle();
      expect(save.done).toBe(false);
      await server.show({ ...running("save-work", "save-2"), code: "vibe64_session_save_update_required",
        events: [{ kind: "save-started", status: "running" },
          { kind: "save-update-required", message: "Update this session first.", status: "ready" }],
        status: "ready", updateRequired: true });
      await expect(save.result).rejects.toMatchObject({
        code: "vibe64_session_save_update_required", message: "Update this session first."
      });
    } finally { f.app.unmount(); }
  });

  it("stops following when the person opens another session; the work runs on at the server", async () => {
    const f = mountedHostFixture();
    hostWorkServer(f, {
      "/save": { ok: true, operation: running("save-work", "save-2"), operationId: "save-2", running: true }
    });
    try {
      const save = tracked(f.host.saveSessionWork());
      await settle();
      expect(save.done).toBe(false);
      f.props.sessionId = "another-session";
      await expect(save.result).resolves.toBe(false);
    } finally { f.app.unmount(); }
  });
});
