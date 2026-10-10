import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";

import { agentMessageInputValidator } from "../../packages/vibe64-sessions/src/server/inputSchemas.js";
import {
  agentMessageAcceptanceSignal,
  agentTurnControlPayloadFromContext,
  createVibe64SessionWorkRefreshQueue,
  focusRuntimeSessionChat,
  proxySessionDialogs,
  runtimeHostAgentWorking,
  runtimeHostToolbarSessions,
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

  it("serializes work inspection and suppresses an invalidated response", async () => {
    let active = 0;
    let calls = 0;
    let maximumActive = 0;
    const releases = [];
    const states = [];
    const queue = createVibe64SessionWorkRefreshQueue({
      async inspect({ isCurrent }) {
        const call = calls;
        calls += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        const state = await new Promise((resolve) => {
          releases[call] = resolve;
        });
        active -= 1;
        if (isCurrent()) {
          states.push(state);
        }
      }
    });

    const first = queue.request();
    await Promise.resolve();
    const second = queue.request();
    const third = queue.request();
    expect(calls).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);

    releases[0]({ operation: { status: "running" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(2);

    releases[1]({ operation: { status: "ready" } });
    await Promise.all([first, second, third]);

    expect(maximumActive).toBe(1);
    expect(calls).toBe(2);
    expect(states).toEqual([{ operation: { status: "ready" } }]);
    queue.dispose();
  });

  it("lets an early chat request wait for declared workspace preparation", () => {
    const controller = new AbortController();
    const signal = agentMessageAcceptanceSignal(controller, {
      waitingForWorkspaceSetup: true
    });

    expect(signal).toBe(controller.signal);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
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
      genesisTask: "work"
    }, {
      context: "unsupported Genesis message request contract"
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
const mountedHostMocks = vi.hoisted(() => ({
  conversation: vi.fn(), renewal: vi.fn(), request: vi.fn(), events: vi.fn(),
  route: { path: "/app/project/one", hash: "", query: { session: "working-one" } },
  replace: vi.fn(), beforeResolve: vi.fn()
}));
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal()),
  useRoute: () => mountedHostMocks.route,
  useRouter: () => ({ replace: mountedHostMocks.replace, beforeResolve: mountedHostMocks.beforeResolve })
}));
vi.mock("../../src/composables/useVibe64ConversationRuntime.js", () => ({
  useVibe64ConversationRuntime: mountedHostMocks.conversation
}));
vi.mock("../../src/composables/useVibe64SessionRenewal.js", () => ({
  useVibe64SessionRenewal: mountedHostMocks.renewal
}));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent: mountedHostMocks.events
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
function mountedHostFixture({ learning = false, learnerId = "learner-one", workingLoadError } = {}) {
  const attemptId = "314cdfd8-182f-4e15-8f79-71381e4a89b4";
  const session = { sessionId: learning ? `learning-${attemptId}` : "working-one",
    ...(learning ? { purpose: "learning", learningAttemptId: attemptId } : {}),
    agentSession: { turn: {} } };
  const state = reactive({ sessions: [session], selectedSessionId: session.sessionId, learnerId, apiPath: "/api/projects/one/vibe64/sessions" });
  const props = reactive({ active: true, sessionId: session.sessionId, projectContext: { slug: "one" } });
  props.sessionData = {
    sessions: computed(() => state.sessions),
    sessionsApiPath: computed(() => state.apiPath),
    learningLearnerId: computed(() => state.learnerId),
    learningLoadError: ref(""), sessionList: { loadError: "working list temporarily unavailable" },
    shortSessionId: id => id, refreshSessionData: vi.fn(async () => {}),
    selectedSessionId: computed(() => state.selectedSessionId),
    selectSessionId: vi.fn(),
    canCreateSession: true, createSessionVisible: true,
    archive: { command: { isRunning: false }, request: vi.fn() }
  };
  // Props in the actual component are shallow: preserve the same ref contract.
  const hostProps = { get active() { return props.active; }, get sessionId() { return props.sessionId; },
    get projectContext() { return props.projectContext; }, sessionData: {
      ...props.sessionData,
      ...(workingLoadError === undefined ? {} : { workingLoadError: ref(workingLoadError) }),
      sessions: computed(() => state.sessions),
      selectedSessionId: computed(() => state.selectedSessionId),
      sessionsApiPath: computed(() => state.apiPath), learningLearnerId: computed(() => state.learnerId)
    } };
  mountedHostMocks.conversation.mockClear(); mountedHostMocks.renewal.mockClear();
  mountedHostMocks.request.mockClear(); mountedHostMocks.events.mockClear();
  mountedHostMocks.route.path = "/app/project/one";
  mountedHostMocks.route.hash = "";
  mountedHostMocks.route.query = { session: "working-one" };
  mountedHostMocks.replace.mockReset().mockResolvedValue(undefined);
  mountedHostMocks.beforeResolve.mockReset().mockImplementation(() => vi.fn());
  const send = vi.fn(async () => true);
  mountedHostMocks.conversation.mockImplementation(() => shallowRef({
    mounted: { session: ref(session), detailState: ref({}), agentConnectionError: ref(""),
      agentConnectionStatus: ref("connected"), refresh: vi.fn(async () => {}) }, sendAgentMessage: send
  }));
  mountedHostMocks.renewal.mockImplementation(() => ({
    sourceOperationsSuspended: ref(false),
    renewal: ref({ status: "completed", successor: { sessionId: "fresh-one" } })
  }));
  mountedHostMocks.request.mockResolvedValue({ ok: true, unsaved: false });
  let host;
  const app = mountedHostRenderer.createApp({ setup() {
    host = useVibe64SessionRuntimeHost(hostProps, vi.fn()); return () => h("div");
  } });
  app.mount({});
  return { app, host, props, hostProps, state, attemptId, send };
}

describe("same keyed Main host across purpose filters", () => {
  it("retains a learning record's exact target when visible project, selection and filter change", async () => {
    const f = mountedHostFixture({ learning: true });
    try {
      const captured = mountedHostMocks.conversation.mock.calls[0][0];
      const readTarget = () => ({ sessionId: toValue(captured.sessionId), projectSlug: toValue(captured.projectSlug),
        learnerId: toValue(captured.learnerId), learningAttemptId: toValue(captured.learningAttemptId),
        sessionsApiPath: toValue(captured.sessionsApiPath) });
      const expected = { sessionId: `learning-${f.attemptId}`, projectSlug: "", learnerId: "learner-one",
        learningAttemptId: f.attemptId, sessionsApiPath: `/api/learning/${f.attemptId}/vibe64/sessions` };
      expect(readTarget()).toEqual(expected);
      f.props.active = false; f.props.projectContext = { slug: "two" }; f.props.sessionId = "working-two";
      f.state.apiPath = "/api/projects/two/vibe64/sessions"; f.state.learnerId = "different-learner";
      await nextTick();
      expect(readTarget()).toEqual(expected);
      expect(toValue(captured.active)).toBe(false);
      expect(mountedHostMocks.conversation).toHaveBeenCalledTimes(1);
      expect(f.host.selection.selectedSessionId).toBe(expected.sessionId);
      expect(f.host.guardedPage.value.error).toBe("");
      expect(f.host.autopilotSessionToolbar.canCreateSession).toBe(false);
      expect(f.host.autopilotSessionToolbar.createSessionVisible).toBe(false);
      expect(f.host.autopilotSessionToolbar.workingSessionsApiPath).toBe("/api/projects/two/vibe64/sessions");
      expect(f.host.runtimeProjectContext.value).toEqual({});
      expect(f.host.sourceWorkspaceAvailable.value).toBe(false);
      expect(f.host.codexTerminalCanStart.value).toBe(false);
      await expect(f.host.sendAgentMessage({ message: "same captured request" })).resolves.toBe(true);
      expect(f.send).toHaveBeenCalledWith({ message: "same captured request" });
    } finally { f.app.unmount(); }
  });

  it("does not inspect or mutate a project workspace for a source-less learning host", async () => {
    const f = mountedHostFixture({ learning: true });
    try {
      const renewal = mountedHostMocks.renewal.mock.calls[0][0];
      expect(toValue(renewal.sessionsApiPath)).toBe("");
      expect(toValue(renewal.selectedSessionId)).toBe("");
      await f.host.refreshWorkState();
      await expect(f.host.retryWorkspaceSetup()).resolves.toBe(false);
      await expect(f.host.saveSessionWork()).resolves.toBe(false);
      await expect(f.host.updateSessionWork()).resolves.toBe(false);
      expect(f.host.workState.value.loading).toBe(false);
      expect(mountedHostMocks.request).not.toHaveBeenCalled();
      const event = mountedHostMocks.events.mock.calls[0][0];
      expect(event.matches({ payload: { projectSlug: "one", repositoryWorkflow: { requirePullRequest: true } } })).toBe(false);
    } finally { f.app.unmount(); }
  });

  it("preserves original reactive Working targets and source facilities", async () => {
    const f = mountedHostFixture();
    try {
      const captured = mountedHostMocks.conversation.mock.calls[0][0];
      expect(Object.hasOwn(captured, "learningAttemptId")).toBe(false);
      expect(Object.hasOwn(captured, "learnerId")).toBe(false);
      expect(toValue(captured.projectSlug)).toBe("one");
      expect(toValue(captured.sessionsApiPath)).toBe("/api/projects/one/vibe64/sessions");
      f.props.projectContext = { slug: "two" }; f.state.apiPath = "/api/projects/two/vibe64/sessions";
      await nextTick();
      expect(toValue(captured.projectSlug)).toBe("two");
      expect(toValue(captured.sessionsApiPath)).toBe("/api/projects/two/vibe64/sessions");
      expect(f.host.autopilotSessionToolbar.canCreateSession).toBe(true);
      expect(f.host.sourceWorkspaceAvailable.value).toBe(true);
      expect(f.host.codexTerminalCanStart.value).toBe(true);
      await f.host.refreshWorkState();
      expect(mountedHostMocks.request.mock.calls.some(([path]) => path === "/api/projects/two/vibe64/sessions/working-one/work")).toBe(true);
    } finally { f.app.unmount(); }
  });
});


describe("captured host list errors", () => {
  it("keeps a Working chat tied to its Working reader while Learning is visible", () => {
    const f = mountedHostFixture({ workingLoadError: "" });
    try {
      f.hostProps.sessionData.sessionList.loadError = "Learning unavailable";
      expect(f.host.guardedPage.value.error).toBe("");
      f.hostProps.sessionData.workingLoadError.value = "Working unavailable";
      expect(f.host.guardedPage.value.error).toBe("Working unavailable");
    } finally { f.app.unmount(); }
  });
});


it("captures a confirmed practice Learning source slug separately without enabling unadapted App or source controls", async () => {
  const f = mountedHostFixture({ learning: true });
  f.app.unmount();
  const attemptId = f.attemptId;
  const session = { sessionId: `training-${attemptId}`, purpose: "learning", learningAttemptId: attemptId,
    noExercise: false, projectSlug: "practice-confirmed", agentSession: { turn: {} } };
  f.state.sessions = [session]; f.props.sessionId = session.sessionId;
  mountedHostMocks.conversation.mockImplementation(() => shallowRef({
    mounted: { session: ref(session), detailState: ref({}), agentConnectionError: ref(""),
      agentConnectionStatus: ref("connected"), refresh: vi.fn(async () => {}) }, sendAgentMessage: f.send
  }));
  let host;
  const app = mountedHostRenderer.createApp({ setup() {
    host = useVibe64SessionRuntimeHost(f.hostProps, vi.fn()); return () => h("div");
  } });
  mountedHostMocks.conversation.mockClear(); app.mount({});
  try {
    const captured = mountedHostMocks.conversation.mock.calls[0][0];
    expect(toValue(captured.sessionId)).toBe(session.sessionId);
    expect(toValue(captured.projectSlug)).toBe("");
    expect(captured.noExercise).toBe(false); expect(captured.sourceProjectSlug).toBe("practice-confirmed");
    expect(captured.learningAttemptId).toBe(attemptId);
    expect(toValue(captured.sessionsApiPath)).toBe(`/api/learning/${attemptId}/vibe64/sessions`);
    f.state.sessions = [{ ...session, projectSlug: "wrong-later-row" }];
    f.props.projectContext = { slug: "unrelated-working" }; f.props.sessionId = "unrelated-working-session";
    f.state.apiPath = "/api/projects/unrelated-working/vibe64/sessions"; await nextTick();
    expect(toValue(captured.sessionId)).toBe(session.sessionId);
    expect(captured.sourceProjectSlug).toBe("practice-confirmed"); expect(toValue(captured.projectSlug)).toBe("");
    expect(host.runtimeProjectContext.value).toEqual({});
    expect(host.sourceWorkspaceAvailable.value).toBe(false); expect(host.codexTerminalCanStart.value).toBe(false);
    await expect(host.saveSessionWork()).resolves.toBe(false);
    await expect(host.updateSessionWork()).resolves.toBe(false);
    await expect(host.retryWorkspaceSetup()).resolves.toBe(false);
    expect(mountedHostMocks.request).not.toHaveBeenCalled();
  } finally { app.unmount(); }
});

it("only captured source-bearing Learning exposes App while all source tools remain unavailable", async () => {
  const trueFixture = mountedHostFixture({ learning: true });
  try { expect(trueFixture.host.outputWorkspaceAvailable.value).toBe(false); }
  finally { trueFixture.app.unmount(); }
  const f = mountedHostFixture(); f.app.unmount();
  const session = { sessionId: "saved-initial", purpose: "learning", learningAttemptId: f.attemptId,
    noExercise: false, projectSlug: "practice-confirmed", agentSession: { turn: {} } };
  f.state.sessions = [session]; f.props.sessionId = session.sessionId;
  mountedHostMocks.conversation.mockImplementation(() => shallowRef({ mounted: {
    session: ref(session), detailState: ref({}), agentConnectionError: ref(""), agentConnectionStatus: ref("connected"), refresh: vi.fn(async () => {})
  }, sendAgentMessage: f.send }));
  let host;
  const app = mountedHostRenderer.createApp({ setup() { host = useVibe64SessionRuntimeHost(f.hostProps, vi.fn()); return () => h("div"); } });
  app.mount({});
  try {
    expect(host.outputWorkspaceAvailable.value).toBe(true);
    expect(host.sourceWorkspaceAvailable.value).toBe(false);
    expect(host.codexTerminalCanStart.value).toBe(false);
    f.props.projectContext = { slug: "unrelated-working" }; f.props.sessionId = "working-later";
    f.state.sessions = [{ ...session, projectSlug: "wrong-later-row" }]; await nextTick();
    expect(host.outputWorkspaceAvailable.value).toBe(true);
    expect(host.sourceWorkspaceAvailable.value).toBe(false);
    expect(toValue(mountedHostMocks.conversation.mock.calls.at(-1)[0].sessionsApiPath))
      .toBe(`/api/learning/${f.attemptId}/vibe64/sessions`);
    await expect(host.saveSessionWork()).resolves.toBe(false);
    await expect(host.retryWorkspaceSetup()).resolves.toBe(false);
  } finally { app.unmount(); }
});

describe("renewal successor navigation through the existing mounted host", () => {
  it("updates each renewed session link while retaining view choices and ordinary tab behavior", async () => {
    const f = mountedHostFixture();
    try {
      mountedHostMocks.route.hash = "#changes";
      mountedHostMocks.route.query = { session: "working-one", chat: "main", pane: "files", filter: ["a", "b"] };
      mountedHostMocks.replace.mockImplementation(async (target) => {
        Object.assign(mountedHostMocks.route, target);
      });
      const openSuccessor = mountedHostMocks.renewal.mock.calls[0][0].selectSession;
      await openSuccessor("fresh-one");
      f.host.dialogs.renewal.renewal.successor.sessionId = "fresh-two";
      await openSuccessor("fresh-two");
      expect(mountedHostMocks.replace.mock.calls.map(([target]) => target)).toEqual([
        { path: "/app/project/one", hash: "#changes", query: { session: "fresh-one", chat: "main", pane: "files", filter: ["a", "b"] } },
        { path: "/app/project/one", hash: "#changes", query: { session: "fresh-two", chat: "main", pane: "files", filter: ["a", "b"] } }
      ]);
      expect(f.hostProps.sessionData.selectSessionId.mock.calls).toEqual([["fresh-one"], ["fresh-two"]]);
      f.host.autopilotSessionToolbar.selectSession("clicked-tab");
      expect(mountedHostMocks.replace).toHaveBeenCalledTimes(2);
      expect(mountedHostMocks.route.query.session).toBe("fresh-two");
      expect(f.hostProps.sessionData.selectSessionId).toHaveBeenLastCalledWith("clicked-tab");
    } finally { f.app.unmount(); }
  });

  it("does not select the successor when its route change rejects or returns a navigation failure", async () => {
    const f = mountedHostFixture();
    try {
      const openSuccessor = mountedHostMocks.renewal.mock.calls[0][0].selectSession;
      const failure = new Error("The fresh session route could not be opened.");
      mountedHostMocks.replace.mockRejectedValueOnce(failure).mockResolvedValueOnce(failure);
      await expect(openSuccessor("fresh-one")).rejects.toBe(failure);
      await expect(openSuccessor("fresh-one")).rejects.toBe(failure);
      expect(f.hostProps.sessionData.selectSessionId).not.toHaveBeenCalled();
      expect(mountedHostMocks.route.query.session).toBe("working-one");
    } finally { f.app.unmount(); }
  });

  it("accepts an already-current successor URL and restores its selection on reload", async () => {
    const { createMemoryHistory, createRouter } = await import("vue-router");
    const { effectScope } = await import("vue");
    const { useVibe64SessionSelection } = await import("../../src/composables/useVibe64SessionSelection.js");
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/app/project/:slug", component: { render: () => null } }]
    });
    await router.replace({ path: "/app/project/one", hash: "#changes", query: { session: "fresh-one", chat: "main" } });
    const f = mountedHostFixture();
    const scope = effectScope();
    try {
      Object.assign(mountedHostMocks.route, router.currentRoute.value);
      mountedHostMocks.replace.mockImplementation((target) => router.replace(target));
      await mountedHostMocks.renewal.mock.calls[0][0].selectSession("fresh-one");
      expect(f.hostProps.sessionData.selectSessionId).toHaveBeenCalledWith("fresh-one");
      const reloaded = scope.run(() => useVibe64SessionSelection({
        projectSlug: ref("renewal-route-reload"), route: router.currentRoute.value
      }));
      expect(reloaded.selectedId.value).toBe("fresh-one");
      expect(router.currentRoute.value.query).toEqual({ session: "fresh-one", chat: "main" });
      expect(router.currentRoute.value.hash).toBe("#changes");
    } finally { scope.stop(); f.app.unmount(); }
  });
});


describe("renewal navigation retains the original current-host fences", () => {
  it("aborts deferred successor navigation after an explicit different tab is selected", async () => {
    const { createMemoryHistory, createRouter, isNavigationFailure, NavigationFailureType } = await import("vue-router");
    const router = createRouter({ history: createMemoryHistory(),
      routes: [{ path: "/app/project/:slug", component: { render: () => null } }] });
    await router.replace("/app/project/one?session=working-one");
    const f = mountedHostFixture();
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    let entered;
    const started = new Promise(resolve => { entered = resolve; });
    const removeDelay = router.beforeEach(async () => { entered(); await waiting; });
    const removed = vi.fn();
    mountedHostMocks.beforeResolve.mockImplementation(guard => {
      const remove = router.beforeResolve(guard);
      return () => { removed(); remove(); };
    });
    mountedHostMocks.replace.mockImplementation(async target => {
      const failure = await router.replace(target);
      Object.assign(mountedHostMocks.route, router.currentRoute.value);
      return failure;
    });
    try {
      const opening = mountedHostMocks.renewal.mock.calls[0][0].selectSession("fresh-one").catch(error => error);
      await started;
      f.state.selectedSessionId = "clicked-tab";
      f.props.active = false;
      release();
      const failure = await opening;
      expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(true);
      expect(router.currentRoute.value.query.session).toBe("working-one");
      expect(f.hostProps.sessionData.selectSessionId).not.toHaveBeenCalled();
      expect(removed).toHaveBeenCalledOnce();
    } finally { release(); removeDelay(); f.app.unmount(); }
  });

  it("accepts route-driven successor selection even when it deactivates the predecessor host", async () => {
    const { createMemoryHistory, createRouter } = await import("vue-router");
    const router = createRouter({ history: createMemoryHistory(),
      routes: [{ path: "/app/project/:slug", component: { render: () => null } }] });
    await router.replace("/app/project/one?session=working-one");
    const f = mountedHostFixture();
    mountedHostMocks.beforeResolve.mockImplementation(guard => router.beforeResolve(guard));
    mountedHostMocks.replace.mockImplementation(async target => {
      const failure = await router.replace(target);
      Object.assign(mountedHostMocks.route, router.currentRoute.value);
      return failure;
    });
    const removeAfter = router.afterEach((to, _from, failure) => {
      if (!failure) { f.state.selectedSessionId = to.query.session; f.props.active = false; }
    });
    try {
      await expect(mountedHostMocks.renewal.mock.calls[0][0].selectSession("fresh-one")).resolves.toBe(true);
      expect(router.currentRoute.value.query.session).toBe("fresh-one");
      expect(f.state.selectedSessionId).toBe("fresh-one");
      expect(f.hostProps.sessionData.selectSessionId).not.toHaveBeenCalled();
    } finally { removeAfter(); f.app.unmount(); }
  });

  it("does not reselect after a newer tab wins following the route commit", async () => {
    const { createMemoryHistory, createRouter } = await import("vue-router");
    const router = createRouter({ history: createMemoryHistory(),
      routes: [{ path: "/app/project/:slug", component: { render: () => null } }] });
    await router.replace("/app/project/one?session=working-one");
    const f = mountedHostFixture();
    mountedHostMocks.beforeResolve.mockImplementation(guard => router.beforeResolve(guard));
    mountedHostMocks.replace.mockImplementation(async target => {
      const failure = await router.replace(target);
      Object.assign(mountedHostMocks.route, router.currentRoute.value);
      return failure;
    });
    const removeAfter = router.afterEach((_to, _from, failure) => {
      if (!failure) { f.state.selectedSessionId = "clicked-after-commit"; f.props.active = false; }
    });
    try {
      await expect(mountedHostMocks.renewal.mock.calls[0][0].selectSession("fresh-one")).resolves.toBe(false);
      expect(f.state.selectedSessionId).toBe("clicked-after-commit");
      expect(f.hostProps.sessionData.selectSessionId).not.toHaveBeenCalled();
    } finally { removeAfter(); f.app.unmount(); }
  });
});


it("does not count a successful router redirect as opening the renewal successor", async () => {
  const { createMemoryHistory, createRouter } = await import("vue-router");
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/app/project/:slug", component: { render: () => null } },
    { path: "/login", component: { render: () => null } }
  ] });
  await router.replace("/app/project/one?session=working-one");
  const f = mountedHostFixture();
  const removeRedirect = router.beforeEach(to => to.query.session === "fresh-one" ? { path: "/login" } : undefined);
  mountedHostMocks.beforeResolve.mockImplementation(guard => router.beforeResolve(guard));
  mountedHostMocks.replace.mockImplementation(async target => {
    const failure = await router.replace(target);
    Object.assign(mountedHostMocks.route, router.currentRoute.value);
    return failure;
  });
  try {
    await expect(mountedHostMocks.renewal.mock.calls[0][0].selectSession("fresh-one")).resolves.toBe(false);
    expect(router.currentRoute.value.path).toBe("/login");
    expect(f.state.selectedSessionId).toBe("working-one");
    expect(f.hostProps.sessionData.selectSessionId).not.toHaveBeenCalled();
  } finally { removeRedirect(); f.app.unmount(); }
});
