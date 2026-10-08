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
