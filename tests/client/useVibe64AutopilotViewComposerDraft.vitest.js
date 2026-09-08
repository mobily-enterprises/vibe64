import { createApp, effectScope, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sessionRepositoryWorkState } from "../../src/composables/useVibe64SessionPanel.js";
import { createVibe64SessionRepositoryStatusQueue } from "../../src/composables/useVibe64SessionRepositoryStatusRegistry.js";

const route = reactive({
  path: "/app/project/chat-test/dashboard/env"
});
const router = {
  push: vi.fn(),
  replace: vi.fn()
};
const viewScopes = new Set();
const accountMocks = vi.hoisted(() => ({ useVibe64Accounts: vi.fn() }));

vi.mock("vue-router", () => ({
  useRoute: () => route,
  useRouter: () => router
}));
vi.mock("@/composables/useVibe64ProjectScope.js", async () => {
  const { ref } = await import("vue");
  return {
    useVibe64ProjectSlug: () => ref("chat-test")
  };
});
vi.mock("@/composables/useVibe64AgentSettings.js", async () => {
  const { ref } = await import("vue");
  return {
    useVibe64AgentSettings: () => ({
      settings: ref({
        model: "",
        providerId: "codex",
        thinking: ""
      }),
      update: vi.fn()
    })
  };
});
vi.mock("@/lib/vibe64AsyncComponent.js", () => ({
  defineVibe64AsyncComponent: ({ label = "Async component" } = {}) => ({
    name: label.replaceAll(" ", "")
  })
}));
vi.mock("@local/vibe64-accounts/client", () => accountMocks);

function viewProps(overrides = {}) {
  return reactive({
    active: true,
    agentConnectionStatus: "connected",
    cancelAgentMessage: vi.fn(async () => true),
    chatCollapsed: false,
    conversationLog: {
      turns: []
    },
    interruptAgentTurn: vi.fn(async () => true),
    page: {},
    projectContext: {},
    projectPane: "dashboard",
    refreshSessionData: vi.fn(async () => null),
    retryWorkspaceSetup: vi.fn(async () => true),
    saveSessionWork: vi.fn(async () => ({ ok: true, status: "saved" })),
    sendAgentMessage: vi.fn(async () => true),
    session: {
      agentSession: {
        turn: {}
      },
      metadata: {
        repository_mode: "github",
        source_kind: "session_clone",
        source_path: "/tmp/sessions/active/session-1/source",
        source_path_authority: "managed_session_source"
      },
      sessionId: "session-1",
      sessionRoot: "/tmp/state/session-1",
      source: "/tmp/sessions/active/session-1/source"
    },
    sessionArchive: {},
    sessionSelectionArchived: false,
    sessionsApiPath: "/api/sessions",
    sessionToolbar: {},
    updateSessionWork: vi.fn(async () => ({ ok: true, status: "updated" })),
    workState: {},
    ...overrides
  });
}

async function createView(overrides = {}, options = {}) {
  return (await createViewWithProps(overrides, options)).view;
}

async function createViewWithProps(overrides = {}, options = {}) {
  const { useVibe64AutopilotView } = await import(
    "../../src/composables/useVibe64AutopilotView.js"
  );
  const props = viewProps(overrides);
  const emit = options.emit || vi.fn();
  const viewOptions = { ...options };
  delete viewOptions.emit;
  const scope = effectScope();
  viewScopes.add(scope);
  const app = createApp({});
  return {
    emit,
    props,
    view: app.runWithContext(() => scope.run(() => useVibe64AutopilotView(props, emit, viewOptions)))
  };
}

function deferredResult() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value))
  };
}

describe("useVibe64AutopilotView direct chat", () => {
  afterEach(() => {
    viewScopes.forEach((scope) => scope.stop());
    viewScopes.clear();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    route.path = "/app/project/chat-test/dashboard/env";
    router.push.mockReset();
    router.replace.mockReset();
    accountMocks.useVibe64Accounts.mockReset().mockReturnValue({ status: ref(null) });
  });

  it("uses the new-build welcome for a blank, workspace-unconfigured project", async () => {
    const view = await createView();

    expect(view.chatTurns.value).toEqual([]);
    expect(view.workspaceSetupStatus.value).toBe("unconfigured");
    expect(view.emptyConversationWelcome.value).toBe(
      "Hi! 👋 I’m excited to build something with you. Tell me what you have in mind—even a half-formed idea is perfect. We’ll shape it together."
    );
    expect(view.composerPlaceholder.value).toBe("");

    const loadingView = await createView({
      conversationLog: {
        loading: true,
        turns: []
      }
    });
    expect(loadingView.chatTurns.value).toEqual([]);
    expect(loadingView.emptyConversationWelcome.value).toBe("");

    const existingView = await createView({
      conversationLog: {
        turns: [{
          assistant: {
            role: "assistant",
            text: "Existing reply."
          },
          turnId: "turn-1"
        }]
      }
    });
    expect(existingView.chatTurns.value).toHaveLength(1);
    expect(existingView.chatTurns.value[0].turnId).toBe("turn-1");
    expect(existingView.emptyConversationWelcome.value).toBe("");
  });

  it("recognises an existing configured project in the empty-conversation welcome", async () => {
    const view = await createView({
      session: {
        ...viewProps().session,
        workspaceSetup: {
          status: "succeeded"
        }
      }
    });

    expect(view.chatTurns.value).toEqual([]);
    expect(view.emptyConversationWelcome.value).toBe(
      "Hi! 👋 This is an existing project. Tell me what you’d like to change, check, or improve, and we’ll work through it together."
    );
  });

  it("makes renewed-session continuity explicit instead of showing new-project onboarding", async () => {
    const { emptyConversationWelcomeText } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );
    const view = await createView({
      session: {
        ...viewProps().session,
        metadata: {
          ...viewProps().session.metadata,
          renewed_from: "previous-session"
        }
      }
    });

    expect(view.emptyConversationWelcome.value).toBe(
      "Hi! 👋 I’ve received the handover from the previous session and I’m ready to continue. Tell me what you’d like to do next."
    );
    expect(emptyConversationWelcomeText({
      existingProject: false,
      renewedSession: true
    })).toBe(
      "Hi! 👋 I’ve received the handover from the previous session and I’m ready to continue. Tell me what you’d like to do next."
    );
    expect(emptyConversationWelcomeText({
      existingProject: true,
      preferredName: "Ada",
      renewedSession: true
    })).toBe(
      "Hi Ada! 👋 I’ve received the handover from the previous session and I’m ready to continue. Tell me what you’d like to do next."
    );
  });

  it("uses a saved preferred name naturally in both project welcomes", async () => {
    const { emptyConversationWelcomeText } = await import(
      "../../src/composables/useVibe64AutopilotView.js"
    );

    expect(emptyConversationWelcomeText({ preferredName: "Ada" })).toMatch(/^Hi Ada! 👋/u);
    expect(emptyConversationWelcomeText({
      existingProject: true,
      preferredName: "Ada"
    })).toBe(
      "Hi Ada! 👋 This is an existing project. Tell me what you’d like to change, check, or improve, and we’ll work through it together."
    );
  });

  it("reads the standalone profile reactively when no host supplies a welcome name", async () => {
    const status = ref({ personalProfile: { preferredName: "Ada" } });
    accountMocks.useVibe64Accounts.mockReturnValue({ status });
    const view = await createView();

    expect(view.emptyConversationWelcome.value).toMatch(/^Hi Ada! 👋/u);
    status.value = { personalProfile: { preferredName: "Grace" } };
    expect(view.emptyConversationWelcome.value).toMatch(/^Hi Grace! 👋/u);
    status.value = { personalProfile: { preferredName: "" } };
    expect(view.emptyConversationWelcome.value).toMatch(/^Hi! 👋/u);
    expect(accountMocks.useVibe64Accounts).toHaveBeenCalledTimes(1);
  });

  it("keeps chat available for steering while Codex is working", async () => {
    const view = await createView({
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });

    view.composerDraft.value = "Use the existing parser.";

    expect(view.agentStopVisible.value).toBe(true);
    expect(view.composerDisabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(true);
    expect(view.composerHint.value).toBe("");
  });

  it("keeps the editor writable while initial delivery is unresolved", async () => {
    const delivery = deferredResult();
    const sendAgentMessage = vi.fn(() => delivery.promise);
    const { props, view } = await createViewWithProps({ sendAgentMessage });
    view.composerDraft.value = "Start with the parser.";

    const submission = view.submitComposerMessage();
    await nextTick();

    expect(view.composerSending.value).toBe(true);
    expect(view.composerSubmitMode.value).toBe("sending");
    expect(view.composerDisabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(false);
    expect(view.composerDraft.value).toBe("");

    view.composerDraft.value = "Then cover the completion race.";
    props.session.agentSession.turn = {
      active: true,
      id: "",
      state: "starting"
    };
    await nextTick();

    expect(view.composerDraft.value).toBe("Then cover the completion race.");
    expect(view.composerDisabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(false);
    expect(view.composerSubmitMode.value).toBe("waiting");

    delivery.resolve(true);
    await expect(submission).resolves.toBe(true);
    expect(view.composerDraft.value).toBe("Then cover the completion race.");
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps scroll identity stable and follows only an accepted local submission", async () => {
    const delivery = deferredResult();
    const sendAgentMessage = vi.fn()
      .mockImplementationOnce(() => delivery.promise)
      .mockResolvedValueOnce(false);
    const { props, view } = await createViewWithProps({ sendAgentMessage });

    expect(view.conversationScrollKey.value).toBe("session-1");
    expect(view.conversationFollowLatestKey.value).toBe(0);

    props.conversationLog.turns.push({
      turnId: "remote-turn",
      user: {
        role: "user",
        text: "A collaborator sent this."
      }
    });
    await nextTick();
    expect(view.conversationScrollKey.value).toBe("session-1");
    expect(view.conversationFollowLatestKey.value).toBe(0);

    view.composerDraft.value = "Follow my accepted message.";
    const accepted = view.submitComposerMessage();
    await nextTick();
    expect(view.conversationFollowLatestKey.value).toBe(0);

    delivery.resolve(true);
    await expect(accepted).resolves.toBe(true);
    expect(view.conversationFollowLatestKey.value).toBe(1);

    view.composerDraft.value = "Do not follow a rejected message.";
    await expect(view.submitComposerMessage()).resolves.toBe(false);
    expect(view.conversationFollowLatestKey.value).toBe(1);
  });

  it("waits for authoritative connected turn readiness before offering Steer", async () => {
    const { props, view } = await createViewWithProps();
    view.composerDraft.value = "Use the existing helper.";

    props.session.agentSession.turn = {
      active: true,
      id: "",
      state: "starting"
    };
    await nextTick();
    expect(view.composerSubmitMode.value).toBe("waiting");
    expect(view.composerCanSubmit.value).toBe(false);

    props.session.agentSession.turn = {
      active: true,
      id: "turn-1",
      state: "finalizing"
    };
    await nextTick();
    expect(view.composerSubmitMode.value).toBe("waiting");
    expect(view.composerCanSubmit.value).toBe(false);

    props.session.agentSession.turn = {
      active: true,
      id: "turn-1",
      state: "active"
    };
    props.agentConnectionStatus = "disconnected";
    await nextTick();
    expect(view.composerSubmitMode.value).toBe("waiting");
    expect(view.composerCanSubmit.value).toBe(false);

    props.agentConnectionStatus = "connected";
    await nextTick();
    expect(view.composerSubmitMode.value).toBe("steer");
    expect(view.composerCanSubmit.value).toBe(true);
  });

  it("preserves a session draft through hidden, reconnecting, and warm-route states", async () => {
    const { props, view } = await createViewWithProps();
    view.composerDraft.value = "Keep this session-specific draft.";

    props.active = false;
    props.agentConnectionStatus = "reconciling";
    route.path = "/app/project/chat-test/dashboard/files";
    await nextTick();

    expect(view.composerDraft.value).toBe("Keep this session-specific draft.");
    expect(view.composerDisabled.value).toBe(true);

    props.active = true;
    props.agentConnectionStatus = "connected";
    route.path = "/app/project/chat-test/dashboard/env";
    await nextTick();
    expect(view.composerDraft.value).toBe("Keep this session-specific draft.");

    props.session = {
      ...props.session,
      sessionId: "session-2"
    };
    await nextTick();
    expect(view.composerDraft.value).toBe("");
  });

  it("sends one text-only Steer and preserves text typed before acceptance", async () => {
    const delivery = deferredResult();
    const sendAgentMessage = vi.fn(() => delivery.promise);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Keep the parser.";

    const submission = view.submitComposerMessage();
    await nextTick();
    expect(view.composerSubmitMode.value).toBe("steering");
    expect(view.composerDraft.value).toBe("");
    await expect(view.submitComposerMessage()).resolves.toBe(false);
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
    expect(sendAgentMessage.mock.calls[0][0]).toMatchObject({
      displayMessage: "Keep the parser.",
      message: "Keep the parser."
    });

    view.composerDraft.value += " Add the race test.";
    delivery.resolve(true);
    await expect(submission).resolves.toBe(true);

    expect(view.composerDraft.value).toBe(" Add the race test.");
    expect(view.composerSubmitMode.value).toBe("steer");
  });

  it("retains a rejected Steer draft and excludes queued attachments", async () => {
    const sendAgentMessage = vi.fn(async () => false);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Do not lose this.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    expect(view.composerDraft.value).toBe("Do not lose this.");

    view.updateComposerAttachments([{
      fileName: "later.txt",
      path: "/tmp/later.txt",
      size: 5
    }]);
    expect(view.composerAttachmentsEnabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(false);
    expect(sendAgentMessage).toHaveBeenCalledTimes(1);
  });

  for (const outcome of ["accepted", "receipt", "rejected"]) {
    it(`keeps a new draft that repeats the submitted Steer after ${outcome}`, async () => {
      const delivery = deferredResult();
      const sendAgentMessage = vi.fn().mockImplementationOnce(() => delivery.promise).mockResolvedValue(true);
      const { props, view } = await createViewWithProps({ sendAgentMessage });
      props.session.agentSession.turn = { active: true, id: "turn-1", state: "active" };
      await nextTick();
      view.composerDraft.value = "Keep the parser.";
      const submission = view.submitComposerMessage();
      expect(view.composerDraft.value).toBe("");
      const messageId = sendAgentMessage.mock.calls[0][0].messageId;
      const newerDraft = "Keep the parser. This is a separate follow-up.";
      view.composerDraft.value = newerDraft;

      if (outcome === "receipt") {
        props.conversationLog.turns = [{
          turnId: "000001",
          user: { role: "user", at: new Date().toISOString(), messageId, text: "Keep the parser." }
        }];
      } else {
        delivery.resolve(outcome === "accepted");
      }
      await expect(submission).resolves.toBe(outcome !== "rejected");
      expect(view.composerDraft.value).toBe(newerDraft);
      expect(view.composerSubmitMode.value).toBe("steer");

      if (outcome === "rejected") {
        expect(view.chatTurns.value.at(-1).optimistic.status).toBe("failed");
        await expect(view.resendOptimisticMessage(messageId)).resolves.toBe(true);
        expect(sendAgentMessage.mock.calls[1][0]).toMatchObject({ messageId, message: "Keep the parser." });
        expect(view.composerDraft.value).toBe(newerDraft);
      } else if (outcome === "receipt") {
        delivery.reject(new Error("Late request failure"));
        await nextTick();
        expect(view.composerDraft.value).toBe(newerDraft);
        expect(view.chatTurns.value).toHaveLength(1);
      }
    });
  }

  it("reuses a rejected Steer message id so a lost response cannot duplicate it", async () => {
    const sendAgentMessage = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Keep this idempotent.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    const firstMessageId = sendAgentMessage.mock.calls[0][0].messageId;
    expect(view.composerSubmitMode.value).toBe("retry");
    expect(view.composerDraft.value).toBe("Keep this idempotent.");

    await expect(view.submitComposerMessage()).resolves.toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
    expect(sendAgentMessage.mock.calls[1][0].messageId).toBe(firstMessageId);
    expect(view.composerDraft.value).toBe("");
  });

  it("retries only the rejected Steer and retains text appended to its restored draft", async () => {
    const sendAgentMessage = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Original steer.";

    const first = view.submitComposerMessage();
    await expect(first).resolves.toBe(false);
    view.composerDraft.value += " New thought.";
    const messageId = sendAgentMessage.mock.calls[0][0].messageId;

    await expect(view.submitComposerMessage()).resolves.toBe(true);
    expect(sendAgentMessage.mock.calls[1][0]).toMatchObject({
      message: "Original steer.",
      messageId
    });
    expect(view.composerDraft.value).toBe(" New thought.");
  });

  it("settles an ambiguous Steer when the canonical message id arrives", async () => {
    const sendAgentMessage = vi.fn(async () => false);
    const { props, view } = await createViewWithProps({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "The server may already have this.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    const messageId = sendAgentMessage.mock.calls[0][0].messageId;
    expect(view.composerSubmitMode.value).toBe("retry");

    props.conversationLog.turns = [{
      turnId: "turn-1",
      user: {
        at: new Date().toISOString(),
        messageId,
        role: "user",
        text: "The server may already have this."
      }
    }];
    await nextTick();

    expect(view.composerDraft.value).toBe("");
    expect(view.composerSubmitMode.value).toBe("steer");
    expect(view.chatTurns.value).toHaveLength(1);
  });

  it("settles the retained Steer draft when the failed bubble is resent", async () => {
    const sendAgentMessage = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Retry from the bubble.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    const failedMessageId = view.chatTurns.value.at(-1).optimistic.id;
    await expect(view.resendOptimisticMessage(failedMessageId)).resolves.toBe(true);

    expect(sendAgentMessage.mock.calls[1][0].messageId).toBe(failedMessageId);
    expect(view.composerDraft.value).toBe("");
  });

  it("turns the same unsent draft into a normal message if the turn finishes", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const { props, view } = await createViewWithProps({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "This can be the next turn.";

    props.session.agentSession.turn = {
      active: false,
      id: "turn-1",
      state: "idle"
    };
    await nextTick();

    expect(view.composerSubmitMode.value).toBe("send");
    await expect(view.submitComposerMessage()).resolves.toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "This can be the next turn."
    }));
  });

  it("accepts Deslop from its exact durable receipt before HTTP completion", async () => {
    const delivery = deferredResult();
    const sendAgentMessage = vi.fn(() => delivery.promise);
    const { props, view } = await createViewWithProps({ sendAgentMessage });
    view.savedCommitDeslop.value = "04f8283622d6";
    const sending = view.startSavedCommitDeslop();
    const messageId = sendAgentMessage.mock.calls[0][0].messageId;
    props.session.agentSession.turn = { active: true, id: "turn-1", state: "active" };
    props.conversationLog.turns = [{ user: { messageId: "another-message", text: "Deslop saved commit 04f8283622d6." } }];
    await nextTick();
    expect(view.composerSubmitLabel.value).toBe("Sending…");
    expect(view.savedCommitDeslopSending.value).toBe(true);
    props.conversationLog.turns = [{ user: { messageId, text: "Deslop saved commit 04f8283622d6." } }];
    await expect(sending).resolves.toBe(true);
    expect(view.savedCommitDeslopSending.value).toBe(false);
    expect(view.agentStopEnabled.value).toBe(true);
    view.composerDraft.value = "Keep this draft.";
    expect(view.composerCanSubmit.value).toBe(true);
    delivery.reject(new Error("Late HTTP connection failure"));
    await nextTick();
    expect(view.composerDraft.value).toBe("Keep this draft.");
    expect(view.chatTurns.value.some((turn) => turn.optimistic?.status === "failed")).toBe(false);
  });

  it("releases Stop on its settled turn while the request remains pending", async () => {
    const interrupt = deferredResult();
    const { props, view } = await createViewWithProps({
      interruptAgentTurn: () => interrupt.promise,
      session: {
        ...viewProps().session,
        agentSession: { turn: { active: true, id: "turn-1", state: "active" } }
      }
    });
    const stopping = view.requestAgentInterrupt();
    view.composerDraft.value = "fdd";
    props.session.agentSession.turn = { active: false, id: "unrelated-turn", state: "idle" };
    await nextTick();
    expect(view.composerCanSubmit.value).toBe(false);
    props.session.agentSession.turn = { active: false, id: "turn-1", state: "idle" };
    await expect(stopping).resolves.toBe(true);
    expect(view.composerCanSubmit.value).toBe(true);
    expect(view.agentStopVisible.value).toBe(false);
    interrupt.reject(new Error("Late HTTP connection failure"));
    await nextTick();
    expect(view.composerCanSubmit.value).toBe(true);
  });

  it("does not let an old session's pending send overwrite a new session's draft", async () => {
    const oldDelivery = deferredResult();
    const newDelivery = deferredResult();
    const sendAgentMessage = vi.fn()
      .mockImplementationOnce(() => oldDelivery.promise)
      .mockImplementationOnce(() => newDelivery.promise);
    const { props, view } = await createViewWithProps({ sendAgentMessage });
    props.session.agentSession.turn = { active: true, id: "old-turn", state: "active" };
    view.composerDraft.value = "Old guidance";
    const oldSending = view.submitComposerMessage();
    props.session = { ...viewProps().session, sessionId: "session-2" };
    await nextTick();
    view.composerDraft.value = "New session message";
    await expect(oldSending).resolves.toBe(false);
    expect(view.composerDraft.value).toBe("New session message");
    expect(view.composerCanSubmit.value).toBe(true);
    const newSending = view.submitComposerMessage();
    oldDelivery.reject(new Error("Old session disconnected"));
    await nextTick();
    expect(view.composerSubmitMode.value).toBe("sending");
    newDelivery.resolve({ ok: true });
    await expect(newSending).resolves.toBe(true);
  });

  it("keeps Stop and Steer mutually exclusive without locking the editor", async () => {
    const interrupt = deferredResult();
    const steer = deferredResult();
    const interruptAgentTurn = vi.fn(() => interrupt.promise);
    const sendAgentMessage = vi.fn(() => steer.promise);
    const view = await createView({
      interruptAgentTurn,
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Keep this draft safe.";

    const stopping = view.requestAgentInterrupt();
    await nextTick();
    expect(view.composerDisabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(false);
    await expect(view.submitComposerMessage()).resolves.toBe(false);
    expect(sendAgentMessage).not.toHaveBeenCalled();
    interrupt.resolve(true);
    await expect(stopping).resolves.toBe(true);

    const steering = view.submitComposerMessage();
    await nextTick();
    expect(view.agentStopEnabled.value).toBe(false);
    await expect(view.requestAgentInterrupt()).resolves.toBe(false);
    expect(interruptAgentTurn).toHaveBeenCalledTimes(1);
    steer.resolve(true);
    await expect(steering).resolves.toBe(true);
  });

  it("keeps chat usable while workspace preparation runs", async () => {
    const retryWorkspaceSetup = vi.fn(async () => true);
    const view = await createView({
      retryWorkspaceSetup,
      session: {
        ...viewProps().session,
        workspaceSetup: {
          currentLabel: "Install dependencies",
          status: "running"
        }
      }
    });
    view.composerDraft.value = "Please start with the routes.";

    expect(view.workspaceSetupRunning.value).toBe(true);
    expect(view.workspaceSetupTitle.value).toBe("Preparing workspace…");
    expect(view.workspaceSetupCurrentLabel.value).toBe("Install dependencies");
    expect(view.workspaceSetupRetryDisabled.value).toBe(true);
    expect(view.composerDisabled.value).toBe(false);
    expect(view.composerCanSubmit.value).toBe(true);
    await expect(view.retryWorkspaceSetup()).resolves.toBe(false);
    expect(retryWorkspaceSetup).not.toHaveBeenCalled();
  });

  it("keeps a ready workspace out of the chat activity area", async () => {
    const view = await createView({
      session: {
        ...viewProps().session,
        workspaceSetup: {
          status: "succeeded"
        }
      }
    });

    expect(view.workspaceSetupRunning.value).toBe(false);
    expect(view.workspaceSetupTitle.value).toBe("Workspace prepared");
    expect(view.composerHint.value).toBe("");
  });

  it("retains bounded workspace preparation output without showing a completed collapsed action", async () => {
    const view = await createView({
      session: {
        ...viewProps().session,
        workspaceSetup: {
          status: "succeeded",
          transcript: "Installing dependencies\nWorkspace ready"
        }
      }
    });

    expect(view.workspaceSetupRunning.value).toBe(false);
    expect(view.workspaceSetupTitle.value).toBe("Workspace prepared");
    expect(view.workspaceSetupOutput.value).toBe(
      "Installing dependencies\nWorkspace ready"
    );
  });

  it("retries failed workspace preparation without blocking chat", async () => {
    const retryWorkspaceSetup = vi.fn(async () => true);
    const view = await createView({
      retryWorkspaceSetup,
      session: {
        ...viewProps().session,
        workspaceSetup: {
          diagnostic: "Dependency installation exited with code 1.",
          status: "failed"
        }
      }
    });

    expect(view.workspaceSetupNeedsAttention.value).toBe(true);
    expect(view.workspaceSetupDiagnostic.value).toBe(
      "Dependency installation exited with code 1."
    );
    await expect(view.retryWorkspaceSetup()).resolves.toBe(true);
    expect(retryWorkspaceSetup).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["failed", "Workspace preparation failed", "Dependency installation exited with code 1."],
    ["ambiguous", "Workspace setup needs a choice", "Two Stack components declare different setup recipes."]
  ])("routes %s workspace recovery through Temporary AI", async (status, title, diagnostic) => {
    const sendAgentMessage = vi.fn(async () => true);
    const requestTemporaryAi = vi.fn(async () => ({
      ok: true,
      taskId: "workspace-fix-1"
    }));
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        workspaceSetup: {
          diagnostic,
          status,
          updatedAt: "2026-08-23T12:00:00.000Z"
        }
      }
    }, {
      requestTemporaryAi
    });
    const originalTurns = [...view.chatTurns.value];

    expect(view.workspaceSetupTitle.value).toBe(title);
    await expect(view.askCodexToFixWorkspaceSetup()).resolves.toBe(true);

    expect(requestTemporaryAi).toHaveBeenCalledWith(expect.objectContaining({
      completionMessage: "AI repair finished. Vibe64 is verifying workspace preparation now.",
      dedupeKey: expect.stringContaining(`workspace-setup|session-1|${status}|`),
      displayMessage: "Fix workspace preparation.",
      failureMessage: expect.stringContaining("Vibe64 is checking whether its edits repaired"),
      message: expect.stringContaining(diagnostic),
      nextStepMessage: expect.stringContaining("automatically retry workspace preparation"),
      policy: "workspace_write",
      recoveryNotice: expect.stringContaining("separate temporary chat"),
      title: "Fix workspace preparation"
    }));
    expect(requestTemporaryAi.mock.calls[0][0].message).toContain("preserving its existing work");
    expect(requestTemporaryAi.mock.calls[0][0].message).toContain(
      "Vibe64 will automatically rerun its deterministic workspace preparation"
    );
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(view.chatTurns.value).toEqual(originalTurns);
  });

  it("reruns deterministic workspace preparation after its Temporary AI repair completes or times out", async () => {
    const retryWorkspaceSetup = vi.fn(async () => true);
    const requestTemporaryAi = vi.fn(async () => ({
      ok: true,
      taskId: "workspace-fix-1"
    }));
    const view = await createView({
      retryWorkspaceSetup,
      session: {
        ...viewProps().session,
        workspaceSetup: {
          diagnostic: "The deployment command is not configured.",
          status: "failed",
          transcript: "[Inspect deployment] Failed."
        }
      }
    }, { requestTemporaryAi });

    await expect(view.askCodexToFixWorkspaceSetup()).resolves.toBe(true);
    expect(requestTemporaryAi.mock.calls[0][0].message).toContain(
      "Recent preparation output:\n[Inspect deployment] Failed."
    );
    await expect(view.handleTemporaryAiTaskFinished({
      id: "another-task",
      status: "completed"
    })).resolves.toBe(false);
    await expect(view.handleTemporaryAiTaskFinished({
      id: "workspace-fix-1",
      status: "failed"
    })).resolves.toBe("workspace-setup");
    expect(retryWorkspaceSetup).toHaveBeenCalledTimes(1);

    await expect(view.handleTemporaryAiTaskFinished({
      id: "workspace-fix-1",
      status: "completed"
    })).resolves.toBe(false);
    expect(retryWorkspaceSetup).toHaveBeenCalledTimes(1);

    await expect(view.askCodexToFixWorkspaceSetup()).resolves.toBe(true);
    await expect(view.handleTemporaryAiTaskFinished({
      id: "workspace-fix-1",
      status: "completed"
    })).resolves.toBe("workspace-setup");
    expect(retryWorkspaceSetup).toHaveBeenCalledTimes(2);
  });

  it("checks the actual Update after repair and reports failure before a successful follow-up", async () => {
    const pending = deferredResult();
    const updateSessionWork = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce({ ok: true, status: "updated" });
    const view = await createView({ updateSessionWork });
    const report = vi.fn();
    const task = {
      id: "update-repair", runId: "repair-1", sessionId: "session-1",
      recoveryOperation: "update", status: "completed", outcomeKind: "complete"
    };
    const checking = view.handleTemporaryAiTaskFinished(task, report);
    expect(report).toHaveBeenLastCalledWith(task.id, { status: "checking", message: "Checking Update…" });
    await expect(view.handleTemporaryAiTaskFinished(task, report)).resolves.toBe(false);
    expect(updateSessionWork).toHaveBeenCalledTimes(1);
    pending.reject(new Error("Document still conflicts."));
    await expect(checking).resolves.toBe("repository-update");
    expect(report).toHaveBeenLastCalledWith(task.id, {
      status: "failed", message: "Update still needs attention: Document still conflicts."
    });
    await view.handleTemporaryAiTaskFinished({ ...task, runId: "repair-2" }, report);
    expect(updateSessionWork).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith(task.id, expect.objectContaining({ status: "succeeded" }));
  });

  it.each([
    { status: "failed" }, { status: "interrupted" }, { outcomeKind: "continue" },
    { outcomeKind: "" }, { sessionId: "another-session" }, { recoveryOperation: "" }, { runId: "" }
  ])("does not apply Update for an unverified repair completion: %j", async (override) => {
    const updateSessionWork = vi.fn();
    const view = await createView({ updateSessionWork });
    const report = vi.fn();
    await view.handleTemporaryAiTaskFinished({
      id: "repair", runId: "turn", sessionId: "session-1",
      recoveryOperation: "update", status: "completed", outcomeKind: "complete", ...override
    }, report);
    expect(updateSessionWork).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])("does not report an old Update %s into another session", async (outcome) => {
    const pending = deferredResult();
    const { view, props } = await createViewWithProps({ updateSessionWork: () => pending.promise });
    const report = vi.fn();
    const checking = view.handleTemporaryAiTaskFinished({
      id: "repair", runId: "turn", sessionId: "session-1",
      recoveryOperation: "update", status: "completed", outcomeKind: "complete"
    }, report);
    props.session = { ...props.session, sessionId: "session-2" };
    await nextTick();
    if (outcome === "success") {
      pending.resolve({ ok: true });
    } else {
      pending.reject(new Error("Old session failed."));
    }
    await checking;
    expect(view.saveWorkError.value).toBe("");
    expect(view.saveWorkSending.value).toBe(false);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("keeps a workspace recovery action pending and ignores a rapid duplicate activation", async () => {
    let resolveRecovery;
    const requestTemporaryAi = vi.fn(() => new Promise((resolve) => {
      resolveRecovery = resolve;
    }));
    const view = await createView({
      session: {
        ...viewProps().session,
        workspaceSetup: {
          diagnostic: "Dependency installation exited with code 1.",
          status: "failed"
        }
      }
    }, { requestTemporaryAi });

    const firstRequest = view.askCodexToFixWorkspaceSetup();
    expect(view.workspaceSetupFixSending.value).toBe(true);
    expect(view.workspaceSetupAskDisabled.value).toBe(true);
    await expect(view.askCodexToFixWorkspaceSetup()).resolves.toBe(false);
    expect(requestTemporaryAi).toHaveBeenCalledTimes(1);

    resolveRecovery({ ok: true });
    await expect(firstRequest).resolves.toBe(true);
    expect(view.workspaceSetupFixSending.value).toBe(false);
  });

  it("routes a rejected preview identity through Temporary AI without touching direct chat", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const requestTemporaryAi = vi.fn(async () => ({ ok: true }));
    const view = await createView({ sendAgentMessage }, { requestTemporaryAi });
    const originalTurns = [...view.chatTurns.value];

    await expect(view.askCodexToFixPreviewIdentity({
      error: "User not found.",
      identity: {
        name: "Admin",
        type: "email",
        value: "ada@example.test"
      }
    })).resolves.toBe(true);

    expect(requestTemporaryAi).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: expect.stringContaining("preview-identity|session-1|email|ada@example.test|User not found."),
      message: expect.stringContaining("app-owned, idempotent development seed"),
      policy: "workspace_write",
      title: "Fix preview identity"
    }));
    expect(requestTemporaryAi.mock.calls[0][0].message).toContain("User not found.");
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(view.chatTurns.value).toEqual(originalTurns);
  });

  it.each([
    ["vibe64_session_save_history_diverged", "Save", "operation"],
    ["vibe64_session_update_conflict", "Update", "updateOperation"],
    ["vibe64_session_update_history_diverged", "Update", "updateOperation"]
  ])("routes %s chat recovery through Temporary AI", async (code, action, operationKey) => {
    const requestTemporaryAi = vi.fn(async () => ({ ok: true }));
    const sendAgentMessage = vi.fn(async () => true);
    const diagnostic = `${action} could not preserve the changed history.`;
    const view = await createView({
      sendAgentMessage,
      workState: {
        [operationKey]: {
          code,
          error: diagnostic,
          operationId: `operation-${code}`,
          status: "failed"
        }
      }
    }, { requestTemporaryAi });
    const originalTurns = [...view.chatTurns.value];

    expect(view.saveWorkCanResolveWithTemporaryAi.value).toBe(true);
    await expect(view.fixRepositoryActionError()).resolves.toBe(true);

    expect(requestTemporaryAi).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: `repository-recovery|session-1|${code}|${diagnostic}`,
      message: expect.stringContaining(diagnostic),
      policy: "workspace_write",
      title: `Resolve ${action}`
    }));
    const prompt = requestTemporaryAi.mock.calls[0][0].message;
    expect(prompt).toContain("Vibe64—not Temporary AI—owns every repository operation");
    expect(prompt).toContain("Do not run git add, commit, checkout");
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(view.chatTurns.value).toEqual(originalTurns);
  });

  it.each([
    "vibe64_session_update_conflict",
    "vibe64_session_update_history_diverged"
  ])("routes %s Dashboard recovery through Temporary AI", async (code) => {
    const requestTemporaryAi = vi.fn(async () => ({ ok: true }));
    const sendAgentMessage = vi.fn(async () => true);
    const diagnostic = `Repository update failed with ${code}.`;
    const view = await createView({ sendAgentMessage }, { requestTemporaryAi });
    const originalTurns = [...view.chatTurns.value];

    await expect(view.fixRepositoryError({
      code,
      error: diagnostic,
      title: "Resolve repository update"
    })).resolves.toBe(true);

    expect(requestTemporaryAi).toHaveBeenCalledWith(expect.objectContaining({
      dedupeKey: `repository-recovery|session-1|${code}|${diagnostic}`,
      message: expect.stringContaining(diagnostic),
      policy: "workspace_write",
      title: "Resolve repository update"
    }));
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(view.chatTurns.value).toEqual(originalTurns);
  });

  it("shares one recovery identity between chat and Dashboard for the same update failure", async () => {
    const requestTemporaryAi = vi.fn(async () => ({ ok: true }));
    const code = "vibe64_session_update_conflict";
    const diagnostic = "One file needs review.";
    const view = await createView({
      workState: {
        updateOperation: {
          code,
          error: diagnostic,
          operationId: "update-1",
          status: "failed"
        }
      }
    }, { requestTemporaryAi });

    await expect(view.fixRepositoryActionError()).resolves.toBe(true);
    await expect(view.fixRepositoryError({
      code,
      error: `  ${diagnostic}  `,
      title: "Resolve repository update"
    })).resolves.toBe(true);

    const [chatRecovery, dashboardRecovery] = requestTemporaryAi.mock.calls.map(([request]) => request);
    expect(chatRecovery.dedupeKey).toBe(
      `repository-recovery|session-1|${code}|${diagnostic}`
    );
    expect(dashboardRecovery.dedupeKey).toBe(chatRecovery.dedupeKey);
    expect(chatRecovery.title).toBe("Resolve Update");
    expect(dashboardRecovery.title).toBe("Resolve repository update");
  });

  it("sends a normal chat message and shows it optimistically", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const view = await createView({ sendAgentMessage });
    view.composerDraft.value = "Make the smallest safe change.";

    await expect(view.submitComposerMessage()).resolves.toBe(true);

    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      displayMessage: "Make the smallest safe change.",
      message: "Make the smallest safe change."
    }));
    expect(sendAgentMessage.mock.calls[0][0].messageId).toMatch(/^message_tab_/u);
    expect(view.composerDraft.value).toBe("");
    expect(view.chatTurns.value.at(-1)?.user?.text).toBe("Make the smallest safe change.");
  });

  it("sends shared attachment identities and acknowledges accepted uploads", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const onAttachmentsAccepted = vi.fn();
    const attachmentId = "12345678-1234-4234-8234-123456789abc";
    const view = await createView({ sendAgentMessage }, { onAttachmentsAccepted });
    view.composerDraft.value = "Inspect [Image #1].";
    view.updateComposerAttachments([{
      attachmentId,
      fileName: "screen.png",
      path: "/tmp/screen.png",
      reference: "[Image #1]",
      size: 1024
    }]);

    await view.submitComposerMessage();

    expect(sendAgentMessage.mock.calls[0][0].message).toBe("Inspect [Image #1].");
    expect(sendAgentMessage.mock.calls[0][0].displayMessage).toBe("Inspect [Image #1].");
    expect(sendAgentMessage.mock.calls[0][0].attachmentIds).toEqual([attachmentId]);
    expect(sendAgentMessage.mock.calls[0][0].displayAttachments).toEqual([{
      attachmentId,
      fileName: "screen.png",
      reference: "[Image #1]",
      size: 1024
    }]);
    expect(JSON.stringify(sendAgentMessage.mock.calls[0][0])).not.toContain("/tmp/");
    expect(onAttachmentsAccepted).toHaveBeenCalledWith([attachmentId]);
  });

  it("connects preview capture and diagnostics actions to direct chat", async () => {
    const capture = vi.fn(async () => true);
    const attachDiagnostics = vi.fn(async () => true);
    const view = await createView();

    expect(view.captureVisiblePreview()).toBe(false);
    expect(view.attachPreviewDiagnostics()).toBe(false);

    view.updatePreviewAttachmentState({
      attachDiagnostics,
      capture,
      captureAvailable: true,
      captureBusy: true,
      diagnosticsAvailable: true,
      diagnosticsBusy: false
    });

    expect(view.previewAttachmentState.value).toMatchObject({
      captureAvailable: true,
      captureBusy: true,
      diagnosticsAvailable: true,
      diagnosticsBusy: false
    });
    await expect(view.captureVisiblePreview()).resolves.toBe(true);
    await expect(view.attachPreviewDiagnostics()).resolves.toBe(true);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(attachDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("keeps failed sends recoverable without a workflow retry state", async () => {
    const sendAgentMessage = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const view = await createView({ sendAgentMessage });
    view.composerDraft.value = "Try this change.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    const failedTurn = view.chatTurns.value.at(-1);
    expect(failedTurn.optimistic.status).toBe("failed");

    await expect(view.resendOptimisticMessage(failedTurn.optimistic.id)).resolves.toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledTimes(2);
    expect(sendAgentMessage.mock.calls[1][0].messageId).toBe(
      sendAgentMessage.mock.calls[0][0].messageId
    );
    expect(view.chatTurns.value.at(-1)?.user?.text).toBe("Try this change.");
  });

  it("does not overwrite a newer draft when editing a failed message", async () => {
    const sendAgentMessage = vi.fn(async () => false);
    const view = await createView({ sendAgentMessage });
    view.composerDraft.value = "First message.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);
    const failedMessageId = view.chatTurns.value.at(-1).optimistic.id;
    view.composerDraft.value = "New thought typed while delivery was pending.";

    expect(view.editOptimisticMessage(failedMessageId)).toBe(true);
    expect(view.composerDraft.value).toBe(
      "First message.\n\nNew thought typed while delivery was pending."
    );
  });

  it("restores a failed Steer for editing without losing the new draft", async () => {
    const sendAgentMessage = vi.fn(async () => false);
    const view = await createView({
      sendAgentMessage,
      session: {
        ...viewProps().session,
        agentSession: {
          turn: {
            active: true,
            id: "turn-1",
            state: "active"
          }
        }
      }
    });
    view.composerDraft.value = "Failed steer.";

    const submission = view.submitComposerMessage();
    view.composerDraft.value = "New suffix.";
    await expect(submission).resolves.toBe(false);
    const failedMessageId = view.chatTurns.value.at(-1).optimistic.id;

    expect(view.editOptimisticMessage(failedMessageId)).toBe(true);
    expect(view.composerDraft.value).toBe("Failed steer.\n\nNew suffix.");
  });

  it("shows the server's delivery failure instead of a generic send error", async () => {
    const sendAgentMessage = vi.fn(async () => {
      throw new Error("Codex app-server connection closed during thread reconciliation.");
    });
    const view = await createView({ sendAgentMessage });
    view.composerDraft.value = "Continue the import.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);

    const failedTurn = view.chatTurns.value.at(-1);
    expect(failedTurn.optimistic).toMatchObject({
      error: "Codex app-server connection closed during thread reconciliation.",
      status: "failed"
    });
    expect(view).not.toHaveProperty("composerError");
  });

  it("raises structured execution attention when assistant ownership blocks a send", async () => {
    const message = "Vibe64 refused to start a replacement until the earlier execution is proven empty.";
    const sendAgentMessage = vi.fn(async () => {
      const error = new Error(message);
      error.code = "vibe64_codex_app_server_process_identity_unverified";
      throw error;
    });
    const emit = vi.fn();
    const { view } = await createViewWithProps({ sendAgentMessage }, { emit });
    view.composerDraft.value = "Continue safely.";

    await expect(view.submitComposerMessage()).resolves.toBe(false);

    expect(emit).toHaveBeenCalledWith("execution-attention", {
      category: "ownership",
      code: "vibe64_codex_app_server_process_identity_unverified",
      message
    });
    expect(view.chatTurns.value.at(-1).optimistic.status).toBe("failed");
  });

  it("exposes only the direct session tools, including changes and history", async () => {
    const view = await createView();

    expect(view.sessionToolControls.value.map((tool) => tool.id)).toEqual([
      "info",
      "changes",
      "repository",
      "editor",
      "database",
      "system",
      "ai-terminal"
    ]);
    expect(view.sessionToolControls.value.map((tool) => tool.id)).not.toContain("session-details");

    expect(view.selectSessionTool("info")).toBe(true);
    await nextTick();
    expect(view.dashboardRouteVisible.value).toBe(true);
    expect(router.push).toHaveBeenCalledWith("/app/project/chat-test/dashboard/session");

    expect(view.selectSessionTool("diff")).toBe(false);
  });

  it("exposes the session-owned AI terminal for OpenCode sessions", async () => {
    route.path = "/app/project/chat-test/dashboard/ai-terminal";
    const view = await createView({
      session: {
        ...viewProps().session,
        assistantSelection: {
          engineId: "opencode"
        }
      }
    });

    expect(view.sessionToolControls.value.map((tool) => tool.id)).toContain("ai-terminal");
    expect(view.rightPaneTab.value).toBe("ai-terminal");
    expect(view.selectSessionTool("ai-terminal")).toBe(true);
  });

  it("prefills chat from source tools", async () => {
    const view = await createView();

    expect(view.askCodexAboutSourceEditorFile("src/main.js")).toBe(true);
    expect(view.composerDraft.value).toBe("Please look at `src/main.js` and help me with this file.");
  });

  it("keeps structured numbered questions in ordinary chat", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const view = await createView({
      conversationLog: {
        turns: [{
          assistant: {
            text: "Please answer both.\n[1] Which file?\n[2] Which existing helper?"
          }
        }]
      },
      sendAgentMessage
    });

    expect(view.numberedQuestions.value.map((question) => question.label)).toEqual([
      "Which file?",
      "Which existing helper?"
    ]);
    expect(view.composerCanSubmit.value).toBe(false);
    view.questionAnswers.value.__ui_question_1 = "src/main.js";
    expect(view.composerCanSubmit.value).toBe(false);
    view.questionAnswers.value.__ui_question_2 = "parseInput";
    expect(view.composerCanSubmit.value).toBe(true);

    await view.submitComposerMessage();

    expect(sendAgentMessage.mock.calls[0][0].message).toBe(
      "[1] src/main.js\n[2] parseInput"
    );
  });

  it("hides a submitted structured form while delivery is pending", async () => {
    const delivery = deferredResult();
    const sendAgentMessage = vi.fn(() => delivery.promise);
    const view = await createView({
      conversationLog: {
        turns: [{
          assistant: {
            text: "Please answer.\n[1] Which file?\n[2] Which helper?"
          }
        }]
      },
      sendAgentMessage
    });
    view.questionAnswers.value.__ui_question_1 = "src/main.js";
    view.questionAnswers.value.__ui_question_2 = "parseInput";

    const submission = view.submitComposerMessage();
    await nextTick();

    expect(view.numberedQuestions.value).toEqual([]);
    expect(view.composerDisabled.value).toBe(false);
    view.composerDraft.value = "My next thought stays editable.";
    expect(view.composerDraft.value).toBe("My next thought stays editable.");

    delivery.resolve(true);
    await expect(submission).resolves.toBe(true);
  });

  it("keeps per-question choices from an ordinary assistant message", async () => {
    const view = await createView({
      conversationLog: {
        turns: [{
          assistant: {
            text: [
              "[1] Include callbacks?",
              "Possible answers:",
              "- Complete lifecycle (Recommended)",
              "- Sending first",
              "[2] Existing files?",
              "Possible answers:",
              "- No existing files (Recommended)",
              "- Migration required"
            ].join("\n")
          }
        }]
      }
    });

    expect(view.numberedQuestions.value).toMatchObject([
      {
        choices: [
          { recommended: true, value: "Complete lifecycle" },
          { recommended: false, value: "Sending first" }
        ]
      },
      {
        choices: [
          { recommended: true, value: "No existing files" },
          { recommended: false, value: "Migration required" }
        ]
      }
    ]);
    expect(view.numberedQuestionSelectItems.value).toMatchObject({
      __ui_question_1: [
        { value: "Complete lifecycle" },
        { value: "Sending first" },
        { selectLabel: "I am not sure", value: "I am not sure" }
      ],
      __ui_question_2: [
        { value: "No existing files" },
        { value: "Migration required" },
        { selectLabel: "I am not sure", value: "I am not sure" }
      ]
    });
  });

  it("offers one choice group for numbered recommendations with later possible answers", async () => {
    const sendAgentMessage = vi.fn(async () => true);
    const view = await createView({
      conversationLog: {
        turns: [{
          assistant: {
            text: [
              "Here are the strongest fits:",
              "[1] **JSKIT + Vue** — a modern interactive web stack.",
              "[2] **Laravel** — a full-featured PHP framework.",
              "[3] **Plain Node.js** — a minimal Node backend.",
              "[4] **Go** — a fast single-binary web server.",
              "A database can be added later.",
              "Possible answers:",
              "- `jskit` (Vue + Node, recommended)",
              "- `laravel` (PHP full-framework route)",
              "- `nodejs` (minimal, hands-on)",
              "- `go` (fast single-binary)",
              "Which one should I set up?"
            ].join("\n")
          }
        }]
      },
      sendAgentMessage
    });

    expect(view.numberedQuestions.value).toEqual([]);
    expect(view.answerChoices.value).toEqual([
      { label: "jskit", value: "jskit" },
      { label: "laravel", value: "laravel" },
      { label: "nodejs", value: "nodejs" },
      { label: "go", value: "go" }
    ]);
    view.selectedAnswerChoice.value = "jskit";
    expect(view.composerCanSubmit.value).toBe(true);

    await view.submitComposerMessage();

    expect(sendAgentMessage.mock.calls[0][0].message).toBe("jskit");
  });

  it("lets the user leave structured questions and answer normally", async () => {
    const { props, view } = await createViewWithProps({
      conversationLog: {
        turns: [{
          assistant: {
            text: "Please answer both.\n[1] Which file?\n[2] Which existing helper?"
          }
        }]
      }
    });

    view.composerDraft.value = "Let me explain this in my own words.";
    expect(view.dismissNumberedQuestions()).toBe(true);
    expect(view.numberedQuestions.value).toEqual([]);
    expect(view.composerDraft.value).toBe("Let me explain this in my own words.");
    expect(view.composerCanSubmit.value).toBe(true);

    props.conversationLog = {
      turns: [{
        assistant: {
          text: "Different questions.\n[1] Which subsystem?\n[2] Which operation?"
        }
      }]
    };
    await nextTick();

    expect(view.numberedQuestions.value.map((question) => question.label)).toEqual([
      "Which subsystem?",
      "Which operation?"
    ]);
  });

  it("offers exact-commit Deslop after a reconciled native Save", async () => {
    const saveCommit = "a".repeat(40);
    const sendAgentMessage = vi.fn(async () => true);
    const saveSessionWork = vi.fn(async () => ({
      ok: true,
      reconciled: true,
      saveCommit,
      status: "saved"
    }));
    const view = await createView({
      saveSessionWork,
      sendAgentMessage,
      workState: {
        unsaved: true,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.requestSaveWork()).toBe(true);
    expect(view.saveWorkConfirmOpen.value).toBe(true);
    await expect(view.confirmSaveWork()).resolves.toEqual({
      ok: true,
      reconciled: true,
      saveCommit,
      status: "saved"
    });

    expect(saveSessionWork).toHaveBeenCalledWith();
    expect(sendAgentMessage).not.toHaveBeenCalled();
    expect(view.saveWorkConfirmOpen.value).toBe(false);
    expect(view.savedCommitDeslop.value).toBe(saveCommit);

    await expect(view.startSavedCommitDeslop()).resolves.toBe(true);
    expect(sendAgentMessage).toHaveBeenCalledWith(expect.objectContaining({
      displayMessage: "Deslop saved commit aaaaaaaaaaaa.",
      genesisTask: "deslop",
      message: `Deslop commit ${saveCommit}.`
    }));
    expect(view.savedCommitDeslop.value).toBe("");
  });

  it("does not offer Deslop until Save has reconciled the session", async () => {
    const view = await createView({
      saveSessionWork: vi.fn(async () => ({
        ok: true,
        reconciled: false,
        saveCommit: "b".repeat(40),
        status: "published_needs_reconcile"
      })),
      workState: {
        unsaved: true,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    view.requestSaveWork();
    await view.confirmSaveWork();
    expect(view.savedCommitDeslop.value).toBe("");
  });

  it("shows the Save action only in the active session chat", async () => {
    const { props, view } = await createViewWithProps({
      workState: {
        unsaved: true,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkHeaderVisible.value).toBe(true);
    expect(view.saveWorkHeaderAriaLabel.value).toBe("Save selected session work");

    props.active = false;
    await nextTick();
    expect(view.saveWorkHeaderVisible.value).toBe(false);

    props.active = true;
    props.session = null;
    await nextTick();
    expect(view.saveWorkHeaderVisible.value).toBe(false);
  });

  it("keeps icon-only Save and Update accessible names stable while pending", async () => {
    const saveResult = deferredResult();
    const save = await createView({
      saveSessionWork: vi.fn(() => saveResult.promise),
      workState: {
        unsaved: true,
        updateAvailable: false,
        updateStatusPending: false
      }
    });
    save.requestSaveWork();
    const saving = save.confirmSaveWork();
    await nextTick();
    expect(save.saveWorkHeaderAriaLabel.value).toBe("Save selected session work");
    saveResult.resolve({ ok: true, status: "saved" });
    await expect(saving).resolves.toEqual({ ok: true, status: "saved" });

    const updateResult = deferredResult();
    const update = await createView({
      updateSessionWork: vi.fn(() => updateResult.promise),
      workState: {
        unsaved: true,
        updateAvailable: true,
        updateStatusPending: false
      }
    });
    const updating = update.requestSaveWork();
    await nextTick();
    expect(update.saveWorkHeaderAriaLabel.value).toBe("Update selected session (rebase)");
    updateResult.resolve({ ok: true, status: "updated" });
    await expect(updating).resolves.toEqual({ ok: true, status: "updated" });
  });

  it("treats a Save authority race as an ordinary update requirement", async () => {
    const view = await createView({
      saveSessionWork: vi.fn(async () => ({
        code: "vibe64_session_save_update_required",
        error: "Update before saving.",
        ok: false
      })),
      workState: {
        operation: {
          code: "vibe64_session_save_update_required",
          error: "Update before saving.",
          operationId: "save-race",
          status: "failed"
        },
        unsaved: true,
        updateAvailable: true,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkRequiresUpdate.value).toBe(true);
    expect(view.saveWorkError.value).toBe("");
    expect(view.saveWorkFailure.value).toBeNull();
    expect(view.saveWorkCanResolveWithTemporaryAi.value).toBe(false);
  });

  it("fails closed when Save has no work or the canonical version needs checking", async () => {
    const noChanges = await createView({
      workState: {
        unsaved: false,
        updateAvailable: false,
        updateStatusPending: false
      }
    });
    expect(noChanges.saveWorkDisabled.value).toBe(true);
    expect(noChanges.saveWorkTitle.value).toBe("No work to save");

    const updateSessionWork = vi.fn(async () => ({ ok: true, status: "updated" }));
    const updatePending = await createView({
      updateSessionWork,
      workState: {
        unsaved: true,
        updateAvailable: true,
        updateStatusPending: true
      }
    });
    expect(updatePending.saveWorkDisabled.value).toBe(false);
    expect(updatePending.saveWorkActionLabel.value).toBe("Update this session (rebase)");
    expect(updatePending.saveWorkTitle.value).toContain("preserving its unsaved work");
    await expect(updatePending.requestSaveWork()).resolves.toEqual({
      ok: true,
      status: "updated"
    });
    expect(updateSessionWork).toHaveBeenCalledOnce();
    expect(updatePending.saveWorkConfirmOpen.value).toBe(false);
  });

  it("keeps a failed rebase labeled as an update while Save stays unavailable", async () => {
    const updateOperation = {
      code: "vibe64_session_update_conflict",
      error: "One file needs review.",
      operationId: "update-1",
      status: "failed"
    };
    const view = await createView({
      workState: {
        operation: null,
        unsaved: false,
        updateAvailable: false,
        updateOperation,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkDisabled.value).toBe(true);
    expect(view.saveWorkActionLabel.value).toBe("Save work");
    expect(view.saveWorkActivityIsUpdate.value).toBe(true);
    expect(view.saveWorkActivityLabel.value).toBe("Update this session (rebase)");
    expect(view.saveWorkOperation.value).toStrictEqual(updateOperation);
  });

  it("does not treat completed repository history as current activity", async () => {
    const saveOperation = {
      events: [{ at: "2026-08-23T01:00:00.000Z", message: "Saved older work" }],
      status: "succeeded",
      updatedAt: "2026-08-23T01:00:00.000Z"
    };
    const updateOperation = {
      events: [{ at: "2026-08-23T02:00:00.000Z", message: "Session updated" }],
      status: "succeeded",
      updatedAt: "2026-08-23T02:00:00.000Z"
    };
    const view = await createView({
      workState: {
        operation: saveOperation,
        unsaved: false,
        updateAvailable: false,
        updateOperation,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkOperationActive.value).toBe(false);
    expect(view.saveWorkOperation.value).toBeNull();
    expect(view.saveWorkActivityIsUpdate.value).toBe(false);
    expect(view.saveWorkActivityLabel.value).toBe("Save work");
    expect(view.saveWorkOutput.value).toBe("");
  });

  it.each(["reconciling", "disconnected", "unknown"])("blocks Save and Update while the assistant connection is %s", async (connectionStatus) => {
    const { props, view } = await createViewWithProps({
      agentConnectionStatus: connectionStatus,
      workState: { unsaved: true }
    });
    expect(view.saveWorkDisabled.value).toBe(true);
    expect(view.thinkingVisible.value).toBe(true);
    expect(view.thinkingLabel.value).not.toBe("");
    expect(view.requestSaveWork()).toBe(false);
    await expect(view.confirmSaveWork()).resolves.toBe(false);
    expect(props.saveSessionWork).not.toHaveBeenCalled();
    props.workState.updateAvailable = true;
    await nextTick();
    expect(view.requestSaveWork()).toBe(false);
    expect(props.updateSessionWork).not.toHaveBeenCalled();
    props.agentConnectionStatus = "connected";
    await nextTick();
    expect(view.saveWorkDisabled.value).toBe(false);
    expect(view.thinkingVisible.value).toBe(false);
    await expect(view.requestSaveWork()).resolves.toMatchObject({ ok: true });
    expect(props.updateSessionWork).toHaveBeenCalledOnce();
  });

  it("rechecks readiness when confirming Save and clears the dialog when switching sessions", async () => {
    const { props, view } = await createViewWithProps({ workState: { unsaved: true } });
    expect(view.requestSaveWork()).toBe(true);
    props.agentConnectionStatus = "reconciling";
    await nextTick();
    await expect(view.confirmSaveWork()).resolves.toBe(false);
    expect(props.saveSessionWork).not.toHaveBeenCalled();
    expect(view.saveWorkTitle.value).toContain("Checking the assistant connection");
    props.session = { ...props.session, sessionId: "session-2" };
    await nextTick();
    expect(view.saveWorkConfirmOpen.value).toBe(false);
  });

  it.each([false, true])("dismisses and retries a request rejected before an operation exists (update=%s)", async (update) => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const rejected = vi.fn(async () => { throw new Error("The assistant is still reconnecting."); });
    const { props, view } = await createViewWithProps({
      saveSessionWork: rejected,
      updateSessionWork: rejected,
      workState: {
        unsaved: true,
        updateAvailable: update,
        operation: { operationId: "old-failed-save", status: "failed", error: "Older Save failed" }
      }
    });
    const attempt = async () => {
      if (update) await view.requestSaveWork();
      else { view.requestSaveWork(); await view.confirmSaveWork(); }
    };
    await attempt();
    expect(view.saveWorkOperation.value).toBeNull();
    expect(view.saveWorkActivityKey.value).toBe("");
    expect(view.saveWorkError.value).toContain("still reconnecting");
    expect(view.dismissSaveWorkActivity()).toBe(true);
    await nextTick();
    expect(view.saveWorkError.value).toBe("");
    expect(view.saveWorkFailure.value).toBeNull();
    props.workState.operation = { ...props.workState.operation };
    await nextTick();
    expect(view.saveWorkError.value).toBe("");
    await attempt();
    expect(view.saveWorkError.value).toContain("still reconnecting");
    expect(view.saveWorkActivityDismissed.value).toBe(false);
    expect(rejected).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("ignores a late request failure after switching away and back (update=%s)", async (update) => {
    const response = deferredResult();
    const { props, view } = await createViewWithProps({
      saveSessionWork: () => response.promise,
      updateSessionWork: () => response.promise,
      workState: { unsaved: true, updateAvailable: update }
    });
    const originalSession = props.session;
    const pending = update ? view.requestSaveWork() : view.confirmSaveWork();
    expect(view.saveWorkSending.value).toBe(true);
    expect(view.saveWorkStage.value).toBe("Waiting for the session to be ready");
    expect(view.dismissSaveWorkActivity()).toBe(false);
    props.session = { ...originalSession, sessionId: "session-2" };
    await nextTick();
    props.session = originalSession;
    await nextTick();
    response.reject(new Error("Failure from previous request"));
    await expect(pending).resolves.toBe(false);
    expect(view.saveWorkError.value).toBe("");
    expect(view.saveWorkSending.value).toBe(false);
  });

  it("finishes Save across ordinary session data refreshes", async () => {
    const response = deferredResult();
    const { props, view } = await createViewWithProps({
      saveSessionWork: () => response.promise,
      workState: { unsaved: true }
    });
    const pending = view.confirmSaveWork();
    props.session = { ...props.session, updatedAt: "2026-09-08T10:28:30Z" };
    await nextTick();
    response.resolve({ ok: true, status: "saved" });
    await expect(pending).resolves.toEqual({ ok: true, status: "saved" });
    expect(view.saveWorkSending.value).toBe(false);
  });

  it.each([false, true])("keeps a new request active when an earlier session visit succeeds late (update=%s)", async (update) => {
    const oldResponse = deferredResult();
    const newResponse = deferredResult();
    const send = vi.fn()
      .mockReturnValueOnce(oldResponse.promise)
      .mockReturnValueOnce(newResponse.promise);
    const { props, view } = await createViewWithProps({
      saveSessionWork: send,
      updateSessionWork: send,
      workState: { unsaved: true, updateAvailable: update }
    });
    const originalSession = props.session;
    const oldRequest = update ? view.requestSaveWork() : view.confirmSaveWork();
    props.session = { ...originalSession, sessionId: "session-2" };
    await nextTick();
    props.session = originalSession;
    await nextTick();
    const newRequest = update ? view.requestSaveWork() : view.confirmSaveWork();
    oldResponse.resolve({ ok: true, reconciled: true, saveCommit: "a".repeat(40) });
    await expect(oldRequest).resolves.toBe(false);
    expect(view.saveWorkSending.value).toBe(true);
    expect(view.savedCommitDeslop.value).toBe("");
    newResponse.reject(new Error("Current request failed"));
    await expect(newRequest).resolves.toBe(false);
    expect(view.saveWorkSending.value).toBe(false);
    expect(view.saveWorkError.value).toBe("Current request failed");
  });

  it("keeps a rejected Save separate from newer completed Update history", async () => {
    const error = Object.assign(new Error("Another assistant operation is starting. Try again in a moment."), {
      code: "vibe64_agent_write_mode_busy"
    });
    const view = await createView({
      saveSessionWork: vi.fn(async () => {
        throw error;
      }),
      workState: {
        operation: {
          events: [{ at: "2026-08-24T11:07:44.224Z", message: "Session work was saved." }],
          operationId: "older-save",
          status: "ready",
          updatedAt: "2026-08-24T11:07:44.224Z"
        },
        unsaved: true,
        updateAvailable: false,
        updateOperation: {
          events: [{ at: "2026-08-25T05:07:45.969Z", message: "This session was updated." }],
          operationId: "newer-update",
          status: "ready",
          updatedAt: "2026-08-25T05:07:45.969Z"
        },
        updateStatusPending: false
      }
    });

    expect(view.saveWorkActivityLabel.value).toBe("Save work");
    expect(view.requestSaveWork()).toBe(true);
    await expect(view.confirmSaveWork()).resolves.toBe(false);

    expect(view.saveWorkError.value).toBe(error.message);
    expect(view.saveWorkActivityIsUpdate.value).toBe(false);
    expect(view.saveWorkActivityLabel.value).toBe("Save work");
    expect(view.saveWorkOperation.value).toBeNull();
    expect(view.saveWorkOutput.value).toBe("");
  });

  it("binds Save activity only after the invoked command becomes active", async () => {
    const saveResult = deferredResult();
    const { props, view } = await createViewWithProps({
      saveSessionWork: vi.fn(() => saveResult.promise),
      workState: {
        operation: {
          events: [{ at: "2026-08-24T11:07:44.224Z", message: "Old Save" }],
          operationId: "old-save",
          status: "ready",
          updatedAt: "2026-08-24T11:07:44.224Z"
        },
        unsaved: true,
        updateAvailable: false,
        updateOperation: {
          events: [{ at: "2026-08-25T05:07:45.969Z", message: "Old Update" }],
          operationId: "old-update",
          status: "ready",
          updatedAt: "2026-08-25T05:07:45.969Z"
        },
        updateStatusPending: false
      }
    });

    view.requestSaveWork();
    const saving = view.confirmSaveWork();
    await nextTick();
    expect(view.saveWorkOperation.value).toBeNull();
    expect(view.saveWorkActivityLabel.value).toBe("Save work");

    props.workState.operation = {
      events: [{ at: "2026-08-31T08:30:00.000Z", message: "Current Save started" }],
      operationId: "current-save",
      status: "running",
      updatedAt: "2026-08-31T08:30:00.000Z"
    };
    props.workState.activeOperation = {
      kind: "save",
      operationId: "current-save"
    };
    await nextTick();
    expect(view.saveWorkOperation.value).toStrictEqual(props.workState.operation);
    expect(view.saveWorkOutput.value).toContain("Current Save started");
    expect(view.saveWorkOutput.value).not.toContain("Old Update");

    saveResult.resolve({ ok: true, status: "saved" });
    await expect(saving).resolves.toEqual({ ok: true, status: "saved" });
  });

  it("reattaches after reload only to the server's exact live operation", async () => {
    const liveUpdate = {
      events: [{ at: "2026-08-31T08:31:00.000Z", message: "Live Update" }],
      operationId: "live-update",
      status: "running"
    };
    const view = await createView({
      workState: {
        activeOperation: {
          kind: "update",
          operationId: "live-update"
        },
        operation: {
          events: [{ at: "2026-08-31T08:32:00.000Z", message: "Newer completed Save" }],
          operationId: "completed-save",
          status: "ready",
          updatedAt: "2026-08-31T08:32:00.000Z"
        },
        updateOperation: liveUpdate
      }
    });

    expect(view.saveWorkOperation.value).toStrictEqual(liveUpdate);
    expect(view.saveWorkOperationActive.value).toBe(true);
    expect(view.saveWorkActivityLabel.value).toBe("Update this session (rebase)");
    expect(view.saveWorkOutput.value).toContain("Live Update");
    expect(view.saveWorkOutput.value).not.toContain("Newer completed Save");
  });

  it("remembers dismissed Save and workspace attempts across reloads without hiding new attempts", async () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    const failedSave = {
      error: "The managed repository could not publish this Save.",
      operationId: "save-failed-1",
      status: "failed"
    };
    const failedWorkspace = {
      diagnostic: "Dependency installation exited with code 1.",
      startedAt: "2026-08-31T08:35:00.000Z",
      status: "failed",
      updatedAt: "2026-08-31T08:36:00.000Z"
    };
    const overrides = {
      session: {
        ...viewProps().session,
        workspaceSetup: failedWorkspace
      },
      workState: {
        operation: failedSave,
        unsaved: true
      }
    };
    const firstView = await createView(overrides);

    expect(firstView.saveWorkActivityDismissed.value).toBe(false);
    expect(firstView.workspaceSetupDismissed.value).toBe(false);
    expect(firstView.dismissSaveWorkActivity()).toBe(true);
    expect(firstView.dismissWorkspaceSetupActivity()).toBe(true);
    expect(firstView.saveWorkActivityDismissed.value).toBe(true);
    expect(firstView.workspaceSetupDismissed.value).toBe(true);

    const reloadedView = await createView(overrides);
    expect(reloadedView.saveWorkActivityDismissed.value).toBe(true);
    expect(reloadedView.workspaceSetupDismissed.value).toBe(true);

    const nextAttemptView = await createView({
      session: {
        ...viewProps().session,
        workspaceSetup: {
          ...failedWorkspace,
          startedAt: "2026-08-31T08:40:00.000Z",
          updatedAt: "2026-08-31T08:41:00.000Z"
        }
      },
      workState: {
        operation: {
          ...failedSave,
          operationId: "save-failed-2"
        },
        unsaved: true
      }
    });
    expect(nextAttemptView.saveWorkActivityDismissed.value).toBe(false);
    expect(nextAttemptView.workspaceSetupDismissed.value).toBe(false);
  });

  it("turns the toolbar Save action into Update when the panel monitor finds an incoming version", async () => {
    const updateSessionWork = vi.fn(async () => ({ ok: true, status: "updated" }));
    const view = await createView({
      sessionToolbar: {
        sessions: [{
          repositoryWorkState: {
            state: "update_available"
          },
          sessionId: "session-1"
        }]
      },
      updateSessionWork,
      workState: {
        unsaved: false,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkDisabled.value).toBe(false);
    expect(view.saveWorkActionLabel.value).toBe("Update this session (rebase)");
    expect(view.saveWorkTitle.value).toBe(
      "Update this session (rebase) to the latest saved project version."
    );
    await expect(view.requestSaveWork()).resolves.toEqual({ ok: true, status: "updated" });
    expect(updateSessionWork).toHaveBeenCalledOnce();
  });

  it("keeps the header on Update from canonical notification until the new version is inspected", async () => {
    const oldWork = {
      canonicalCommit: "old-version",
      checkedAt: "2026-09-08T02:26:00.000Z",
      unsaved: true,
      updateAvailable: false
    };
    const { view, props } = await createViewWithProps({
      sessionToolbar: { sessions: [{ sessionId: "session-1" }] },
      workState: oldWork
    });
    const queue = createVibe64SessionRepositoryStatusQueue({
      onState: ({ workState }) => {
        props.sessionToolbar.sessions[0].repositoryWorkState = sessionRepositoryWorkState(workState);
      },
      requestWork: async () => oldWork
    });
    try {
      queue.observe("session-1", oldWork);
      expect(view.saveWorkRequiresUpdate.value).toBe(false);
      queue.markUpdatePending("session-1", "new-version");
      expect(view.saveWorkHeaderAriaLabel.value).toBe("Update selected session (rebase)");

      // A runtime inspection already in flight finishes after the notification.
      props.workState = { ...oldWork, checkedAt: "2026-09-08T02:26:05.000Z" };
      queue.observe("session-1", props.workState);
      expect(view.saveWorkHeaderAriaLabel.value).toBe("Update selected session (rebase)");

      queue.enqueue(["session-1"], { force: true });
      await queue.waitForIdle();
      expect(view.saveWorkRequiresUpdate.value).toBe(true);

      queue.observe("session-1", {
        ...props.workState,
        canonicalCommit: "new-version",
        checkedAt: "2026-09-08T02:26:06.000Z",
        updateAvailable: true
      });
      expect(view.saveWorkRequiresUpdate.value).toBe(true);

      // After a successful Update, the current inspection can offer Save again.
      queue.observe("session-1", {
        ...props.workState,
        canonicalCommit: "new-version",
        checkedAt: "2026-09-08T02:26:07.000Z"
      });
      expect(view.saveWorkHeaderAriaLabel.value).toBe("Save selected session work");
    } finally {
      queue.dispose();
    }
  });

  it("enables Save when the newer toolbar inspection finds unsaved work", async () => {
    const view = await createView({
      sessionToolbar: {
        sessions: [{
          repositoryWorkState: {
            changedCount: 10,
            checkedAt: "2026-08-20T06:20:00.000Z",
            state: "unsaved"
          },
          sessionId: "session-1"
        }]
      },
      workState: {
        checkedAt: "2026-08-20T06:10:00.000Z",
        unsaved: false,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkUnsaved.value).toBe(true);
    expect(view.saveWorkDisabled.value).toBe(false);
    expect(view.saveWorkActionLabel.value).toBe("Save work");
    expect(view.saveWorkTitle.value).toBe("Save this session's work to the project repository");
  });

  it.each([true, false])("preserves the Update requirement after failure (incoming: %s)", async (updateAvailable) => {
    const workState = {
      checkedAt: "2026-09-08T01:03:03.005Z",
      unsaved: true,
      updateAvailable,
      updateOperation: {
        code: "vibe64_session_update_conflict",
        error: "The document conflicts with the latest saved version.",
        operationId: "failed-update",
        status: "failed"
      }
    };
    const updateSessionWork = vi.fn(async () => ({ ok: true, status: "updated" }));
    const view = await createView({
      sessionToolbar: {
        sessions: [{
          repositoryWorkState: sessionRepositoryWorkState(workState),
          sessionId: "session-1"
        }]
      },
      updateSessionWork,
      workState
    });

    expect(view.saveWorkRequiresUpdate.value).toBe(updateAvailable);
    expect(view.saveWorkActionLabel.value).toBe(updateAvailable ? "Update this session (rebase)" : "Save work");
    expect(view.saveWorkDisabled.value).toBe(false);
    if (updateAvailable) {
      await view.requestSaveWork();
      expect(updateSessionWork).toHaveBeenCalledOnce();
      expect(view.saveWorkConfirmOpen.value).toBe(false);
    }
  });

  it("keeps failed Save work retryable when repository inspection is still healthy", async () => {
    const view = await createView({
      sessionToolbar: {
        sessions: [{
          repositoryWorkState: {
            checkedAt: "2026-08-21T03:00:00.000Z",
            state: "needs_help"
          },
          sessionId: "session-1"
        }]
      },
      workState: {
        checkedAt: "2026-08-21T02:59:00.000Z",
        error: "",
        operation: {
          code: "vibe64_session_save_git_failed",
          error: "The managed repository could not publish this Save.",
          operationId: "save-failed",
          status: "failed"
        },
        unsaved: true,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkError.value).toBe("The managed repository could not publish this Save.");
    expect(view.saveWorkDisabled.value).toBe(false);
    expect(view.saveWorkRetryable.value).toBe(true);
    expect(view.retrySaveWork()).toBe(true);
    expect(view.saveWorkConfirmOpen.value).toBe(true);
  });

  it("does not revive stale unsaved toolbar state after a newer selected-session check", async () => {
    const view = await createView({
      sessionToolbar: {
        sessions: [{
          repositoryWorkState: {
            changedCount: 10,
            checkedAt: "2026-08-20T06:10:00.000Z",
            state: "unsaved"
          },
          sessionId: "session-1"
        }]
      },
      workState: {
        checkedAt: "2026-08-20T06:20:00.000Z",
        unsaved: false,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkUnsaved.value).toBe(false);
    expect(view.saveWorkDisabled.value).toBe(true);
    expect(view.saveWorkTitle.value).toBe("No work to save");
  });

  it("does not start a duplicate operation while the repository monitor sees an update running", async () => {
    const view = await createView({
      sessionToolbar: {
        sessions: [{
          repositoryWorkState: {
            checkedAt: "2026-08-20T06:20:00.000Z",
            state: "updating"
          },
          sessionId: "session-1"
        }]
      },
      workState: {
        checkedAt: "2026-08-20T06:10:00.000Z",
        unsaved: true,
        updateAvailable: false,
        updateStatusPending: false
      }
    });

    expect(view.saveWorkActionLabel.value).toBe("Update this session (rebase)");
    expect(view.saveWorkDisabled.value).toBe(true);
    expect(view.saveWorkTitle.value).toBe("Wait for the current repository operation to finish");
  });
});
