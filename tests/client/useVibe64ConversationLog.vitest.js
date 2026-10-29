import { computed, effectScope, nextTick, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const httpRequest = vi.hoisted(() => vi.fn());
const endpointMocks = vi.hoisted(() => ({
  resource: null,
  useEndpointResource: vi.fn()
}));
const realtimeMocks = vi.hoisted(() => ({
  events: []
}));

vi.mock("@jskit-ai/http-web/client/composables/useEndpointResource", () => ({
  useEndpointResource: endpointMocks.useEndpointResource
}));

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient() {
    return { request: httpRequest };
  }
}));

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    realtimeMocks.events.push(options);
    return options;
  }
}));

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths() {
    return {
      api: () => "/api/vibe64/sessions"
    };
  }
}));

vi.mock("@/composables/useVibe64ProjectScope.js", () => ({
  useVibe64ProjectSlug() {
    return ref("project-a");
  }
}));

import {
  conversationLogCompletedTurnKey,
  conversationLogRealtimeShouldRefresh,
  normalizeConversationLog,
  sessionAgentTurnActive,
  useVibe64ConversationLog
} from "../../src/composables/useVibe64ConversationLog.js";
import {
  conversationLogReadQuery,
  mergeConversationLogPages,
  normalizeConversationLogPage
} from "@jskit-ai/assistant-core/shared/conversation";

// Main chat's supplied binding over the mocked saved history: its turns follow
// the resource data and Reload is the resource's reload.
function suppliedConversation() {
  const resource = endpointMocks.resource;
  return { turns: computed(() => normalizeConversationLog(resource.data.value)), error: ref(""), accessDenied: ref(false),
    snapshot: ref({ status: "ready" }), loading: ref(false), reload: (...args) => resource.reload(...args) };
}

describe("useVibe64ConversationLog", () => {
  it("preserves saved attribution while normalizing conversation history", () => {
    const metadata = { assistantSelection: { engineId: "codex", modelId: "gpt-6-astra" } };
    const [turn] = normalizeConversationLog({ conversationLog: [{
      turnId: "000001", metadata, assistant: { role: "assistant", text: "Answer" }
    }] });
    expect(turn.metadata).toEqual(metadata);
  });

  it("recognizes Analytics configuration from chat without executing setup or completing the request", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1" });
    const requestId = "a".repeat(64);
    endpointMocks.resource.data.value.conversationLog = [{ turnId: "000001", assistant: { role: "assistant", text: "Configure Analytics" },
      integrationSetup: { integrationId: "analytics", requestId, outcome: "pending" } }];
    const model = scope.run(() => useVibe64ConversationLog({ session, conversation: suppliedConversation() }));
    const request = { sessionId: "session-1", turnId: "000001", requestId };
    httpRequest.mockResolvedValue({ configuration: { integrations: { analytics: {
      provider: "google-analytics", accountMode: "shared", authentication: { method: "none" }, settings: { measurementId: "G-ABC123" }
    } } } });
    expect(await model.checkIntegrationRequest(request)).toBe(true);
    expect(await model.connectIntegrationRequest(request)).toBe(true);
    expect(httpRequest.mock.calls).toEqual([
      ["/api/vibe64/sessions/session-1/integrations"],
      ["/api/vibe64/sessions/session-1/integrations"]
    ]);
    expect(model.integrationConnections.value[requestId]).toEqual({ status: "configuration-only" });
    expect(endpointMocks.resource.data.value.conversationLog[0].integrationSetup.outcome).toBe("pending");
    scope.stop();
  });
  it("connects from chat and cancels the exact pending attempt while preserving an older grant", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1" });
    const requestId = "a".repeat(64);
    endpointMocks.resource.data.value.conversationLog = [{ turnId: "000001", assistant: { role: "assistant", text: "Configure mail" },
      integrationSetup: { integrationId: "mail", requestId, outcome: "pending" } }];
    const model = scope.run(() => useVibe64ConversationLog({ session, conversation: suppliedConversation() }));
    const request = { sessionId: "session-1", turnId: "000001", requestId };
    const config = { configuration: { integrations: { mail: { accountMode: "shared" } } }, baseHash: "hash" };
    httpRequest.mockResolvedValueOnce(config).mockResolvedValueOnce({ status: "pending", attemptId: "attempt-1", authorizationUrl: "https://provider.example/consent" });
    expect(await model.connectIntegrationRequest(request)).toBe(true);
    expect(httpRequest).toHaveBeenNthCalledWith(2, "/api/vibe64/sessions/session-1/integrations/mail/setup", {
      method: "POST", body: { operation: "connect", setupRequest: { turnId: "000001", requestId, configurationHash: "hash" } }
    });
    expect(model.integrationConnections.value[requestId].attemptId).toBe("attempt-1");
    httpRequest.mockResolvedValueOnce(config).mockResolvedValueOnce({ status: "cancelled" }).mockResolvedValueOnce({ status: "connected", accountLabel: "Old mailbox" });
    expect(await model.cancelIntegrationRequest(request)).toBe(true);
    expect(httpRequest).toHaveBeenNthCalledWith(4, "/api/vibe64/sessions/session-1/integrations/mail/setup", {
      method: "POST", body: { operation: "cancel", attemptId: "attempt-1" }
    });
    expect(model.integrationConnections.value[requestId].accountLabel).toBe("Old mailbox");
    expect(httpRequest.mock.calls.some(([url]) => url.endsWith("/resume"))).toBe(false);
    scope.stop();
  });

  it("recovers consent from application status without starting authorization", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1" });
    const requestId = "a".repeat(64);
    endpointMocks.resource.data.value.conversationLog = [{ turnId: "000001", assistant: { role: "assistant", text: "Configure mail" },
      integrationSetup: { integrationId: "mail", requestId, outcome: "pending" } }];
    const model = scope.run(() => useVibe64ConversationLog({ session, conversation: suppliedConversation() }));
    httpRequest.mockResolvedValueOnce({ configuration: { integrations: { mail: { accountMode: "shared" } } }, baseHash: "hash" })
      .mockResolvedValueOnce({ status: "pending", attemptId: "existing-attempt", authorizationUrl: "https://provider.example/consent" });
    expect(await model.checkIntegrationRequest({ sessionId: "session-1", turnId: "000001", requestId })).toBe(true);
    expect(httpRequest).toHaveBeenLastCalledWith("/api/vibe64/sessions/session-1/integrations/mail/setup", {
      method: "POST", body: { operation: "status", setupRequest: { turnId: "000001", requestId, configurationHash: "hash" } }
    });
    expect(model.integrationConnections.value[requestId].attemptId).toBe("existing-attempt");
    scope.stop();
  });

  it("retains a completed connection when chat continuation is unconfirmed", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1" });
    const requestId = "a".repeat(64);
    endpointMocks.resource.data.value.conversationLog = [{ turnId: "000001", assistant: { role: "assistant", text: "Configure mail" },
      integrationSetup: { integrationId: "mail", requestId, outcome: "pending" } }];
    const model = scope.run(() => useVibe64ConversationLog({ session, conversation: suppliedConversation() }));
    httpRequest.mockResolvedValueOnce({ configuration: { integrations: { mail: { accountMode: "shared" } } }, baseHash: "hash" })
      .mockResolvedValueOnce({ status: "connected", integrationSetup: { outcome: "completed", continuation: { status: "pending" } } })
      .mockResolvedValueOnce({ ok: false, error: "Delivery unconfirmed" });
    expect(await model.connectIntegrationRequest({ sessionId: "session-1", turnId: "000001", requestId })).toBe(false);
    expect(model.integrationConnections.value[requestId].status).toBe("connected");
    expect(model.integrationActionError.value.message).toBe("Delivery unconfirmed");
    expect(endpointMocks.resource.reload).toHaveBeenCalledOnce();
    expect(httpRequest).toHaveBeenLastCalledWith("/api/vibe64/sessions/session-1/integration-setup/resume", {
      method: "POST", body: { turnId: "000001", requestId }
    });
    scope.stop();
  });

  it("does not connect after a configuration reply arrives for a session left behind", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1" });
    const requestId = "a".repeat(64);
    endpointMocks.resource.data.value.conversationLog = [{ turnId: "000001", assistant: { role: "assistant", text: "Configure mail" },
      integrationSetup: { integrationId: "mail", requestId, outcome: "pending" } }];
    const model = scope.run(() => useVibe64ConversationLog({ session, conversation: suppliedConversation() }));
    let finish;
    httpRequest.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = model.connectIntegrationRequest({ sessionId: "session-1", turnId: "000001", requestId });
    session.value = { sessionId: "session-2" };
    await nextTick();
    finish({ configuration: { integrations: { mail: { accountMode: "shared" } } }, baseHash: "hash" });
    expect(await pending).toBe(false);
    expect(httpRequest).toHaveBeenCalledOnce();
    expect(model.integrationConnections.value).toEqual({});
    expect(model.integrationActionError.value).toBeNull();
    scope.stop();
  });

  it("does not resume another session when a completed connection arrives late", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1" });
    const requestId = "a".repeat(64);
    endpointMocks.resource.data.value.conversationLog = [{ turnId: "000001", assistant: { role: "assistant", text: "Configure mail" },
      integrationSetup: { integrationId: "mail", requestId, outcome: "pending" } }];
    const model = scope.run(() => useVibe64ConversationLog({ session, conversation: suppliedConversation() }));
    let finish;
    httpRequest.mockResolvedValueOnce({ configuration: { integrations: { mail: { accountMode: "shared" } } }, baseHash: "hash" })
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = model.connectIntegrationRequest({ sessionId: "session-1", turnId: "000001", requestId });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    session.value = { sessionId: "session-2" };
    await nextTick();
    finish({ status: "connected", integrationSetup: { outcome: "completed", continuation: { status: "pending" } } });
    expect(await pending).toBe(false);
    expect(httpRequest).toHaveBeenCalledTimes(2);
    expect(model.integrationConnections.value).toEqual({});
    expect(model.integrationActionError.value).toBeNull();
    expect(endpointMocks.resource.reload).not.toHaveBeenCalled();
    scope.stop();
  });

  it("recovers a lost completion response from saved chat without reconnecting", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1" });
    const requestId = "a".repeat(64);
    const turn = { turnId: "000001", assistant: { role: "assistant", text: "Configure mail" },
      integrationSetup: { integrationId: "mail", requestId, outcome: "pending" } };
    endpointMocks.resource.data.value.conversationLog = [turn];
    const model = scope.run(() => useVibe64ConversationLog({ session, conversation: suppliedConversation() }));
    const request = { sessionId: "session-1", turnId: "000001", requestId };
    httpRequest.mockResolvedValueOnce({ configuration: { integrations: { mail: { accountMode: "shared" } } }, baseHash: "hash" })
      .mockRejectedValueOnce(new Error("Connection response lost"));
    endpointMocks.resource.reload.mockImplementationOnce(async () => {
      endpointMocks.resource.data.value = { conversationLog: [{ ...turn,
        integrationSetup: { ...turn.integrationSetup, outcome: "completed", continuation: { status: "pending" } }
      }] };
    });
    expect(await model.connectIntegrationRequest(request)).toBe(false);
    expect(model.turns.value[0].integrationSetup.outcome).toBe("completed");
    expect(await model.connectIntegrationRequest(request)).toBe(false);
    expect(httpRequest).toHaveBeenCalledTimes(2);
    httpRequest.mockResolvedValueOnce({ ok: true });
    expect(await model.resumeIntegrationRequest(request)).toBe(true);
    expect(httpRequest).toHaveBeenCalledTimes(3);
    expect(httpRequest).toHaveBeenLastCalledWith("/api/vibe64/sessions/session-1/integration-setup/resume", {
      method: "POST", body: { turnId: "000001", requestId }
    });
    scope.stop();
  });

  it("checks continuation directly from saved chat without requiring integration configuration", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1" });
    const requestId = "a".repeat(64);
    endpointMocks.resource.data.value.conversationLog = [{ turnId: "000001", assistant: { role: "assistant", text: "Configure mail" },
      integrationSetup: { integrationId: "removed-slot", requestId, outcome: "completed", continuation: { status: "sending" } } }];
    const model = scope.run(() => useVibe64ConversationLog({ session, conversation: suppliedConversation() }));
    const request = { sessionId: "session-1", turnId: "000001", requestId };
    expect(await model.resumeIntegrationRequest({ ...request, sessionId: "other" })).toBe(false);
    expect(await model.resumeIntegrationRequest({ ...request, requestId: "b".repeat(64) })).toBe(false);
    httpRequest.mockResolvedValueOnce({ ok: false, error: "Delivery remains unconfirmed." });
    expect(await model.resumeIntegrationRequest(request)).toBe(false);
    expect(httpRequest).toHaveBeenCalledExactlyOnceWith("/api/vibe64/sessions/session-1/integration-setup/resume", {
      method: "POST", body: { turnId: "000001", requestId }
    });
    expect(model.integrationActionError.value.message).toBe("Delivery remains unconfirmed.");
    expect(endpointMocks.resource.reload).toHaveBeenCalledOnce();
    httpRequest.mockResolvedValueOnce({ ok: true });
    expect(await model.resumeIntegrationRequest(request)).toBe(true);
    expect(model.integrationActionPending.value).toBeNull();
    expect(model.integrationActionError.value).toBeNull();
    scope.stop();
  });

  it("skips only a current saved request and reloads after confirmation", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1" });
    const requestId = "a".repeat(64);
    endpointMocks.resource.data.value.conversationLog = [{ turnId: "000001", assistant: { role: "assistant", text: "Configure mail" },
      integrationSetup: { integrationId: "mail", requestId, outcome: "pending" } }];
    const model = scope.run(() => useVibe64ConversationLog({ session, conversation: suppliedConversation() }));
    let finish;
    httpRequest.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const request = { sessionId: "session-1", turnId: "000001", requestId };
    expect(await model.skipIntegrationRequest({ ...request, sessionId: "other" })).toBe(false);
    expect(await model.skipIntegrationRequest({ ...request, requestId: "b".repeat(64) })).toBe(false);
    const pending = model.skipIntegrationRequest(request);
    expect(await model.skipIntegrationRequest(request)).toBe(false);
    expect(httpRequest).toHaveBeenCalledExactlyOnceWith("/api/vibe64/sessions/session-1/integration-setup/skip", {
      method: "POST", body: { turnId: "000001", requestId }
    });
    expect(endpointMocks.resource.reload).not.toHaveBeenCalled();
    finish({ ok: true });
    expect(await pending).toBe(true);
    expect(endpointMocks.resource.reload).toHaveBeenCalledOnce();
    expect(model.integrationActionPending.value).toBeNull();
    expect(model.integrationActionError.value).toBeNull();
    scope.stop();
  });

  it("shows a refused skip and ignores a late error after switching sessions", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1" });
    const requestId = "a".repeat(64);
    endpointMocks.resource.data.value.conversationLog = [{ turnId: "000001", assistant: { role: "assistant", text: "Configure mail" },
      integrationSetup: { integrationId: "mail", requestId, outcome: "pending" } }];
    const model = scope.run(() => useVibe64ConversationLog({ session, conversation: suppliedConversation() }));
    const request = { sessionId: "session-1", turnId: "000001", requestId };
    httpRequest.mockResolvedValueOnce({ ok: false, error: "Assistant access denied." });
    expect(await model.skipIntegrationRequest(request)).toBe(false);
    expect(model.integrationActionError.value.message).toBe("Assistant access denied.");
    expect(model.turns.value[0].integrationSetup.outcome).toBe("pending");
    let fail;
    httpRequest.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    const pending = model.skipIntegrationRequest(request);
    session.value = { sessionId: "session-2" };
    await nextTick();
    fail(new Error("Old request failed"));
    expect(await pending).toBe(false);
    expect(model.integrationActionError.value).toBeNull();
    expect(model.integrationActionPending.value).toBeNull();
    scope.stop();
  });

  beforeEach(() => {
    httpRequest.mockReset();
    endpointMocks.resource = {
      data: ref({
        conversationLog: [],
        ok: true
      }),
      isLoading: ref(false),
      loadError: ref(""),
      reload: vi.fn(async () => null)
    };
    endpointMocks.useEndpointResource.mockReset();
    endpointMocks.useEndpointResource.mockReturnValue(endpointMocks.resource);
    realtimeMocks.events.length = 0;
  });
  it("builds conversation-log page queries from the shared page limit", () => {
    expect(conversationLogReadQuery()).toEqual({
      limit: "10"
    });
    expect(conversationLogReadQuery({
      beforeTurnId: "000005"
    })).toEqual({
      beforeTurnId: "000005",
      limit: "10"
    });
    expect(conversationLogReadQuery({
      beforeTurnId: "000005",
      limit: 2
    })).toEqual({
      beforeTurnId: "000005",
      limit: "2"
    });
  });

  it("normalizes and merges chronological conversation pages", () => {
    const olderPage = normalizeConversationLogPage({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "First."
          }
        },
        {
          turnId: "000002",
          user: {
            role: "user",
            text: "Second."
          }
        }
      ],
      pagination: {
        count: 2,
        hasMoreBefore: false,
        limit: 2,
        newestTurnId: "000002",
        oldestTurnId: "000001",
        totalTurnCount: 4
      }
    });
    const latestPage = normalizeConversationLogPage({
      conversationLog: [
        {
          turnId: "000002",
          user: {
            role: "user",
            text: "Second updated."
          }
        },
        {
          turnId: "000003",
          user: {
            role: "user",
            text: "Third."
          }
        }
      ],
      pagination: {
        count: 2,
        hasMoreBefore: true,
        limit: 2,
        newestTurnId: "000003",
        oldestTurnId: "000002",
        totalTurnCount: 4
      }
    });

    expect(olderPage.pagination.oldestTurnId).toBe("000001");
    expect(mergeConversationLogPages([
      olderPage,
      latestPage
    ])).toEqual({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "First."
          }
        },
        {
          turnId: "000002",
          user: {
            role: "user",
            text: "Second updated."
          }
        },
        {
          turnId: "000003",
          user: {
            role: "user",
            text: "Third."
          }
        }
      ]
    });
  });

  it("normalizes durable conversation turns and ignores empty messages", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          assistant: {
            at: "2026-05-25T01:03:00.000Z",
            role: "assistant",
            text: "Done."
          },
          commentary: [
            {
              at: "2026-05-25T01:02:45.000Z",
              messageId: "codex-progress-1",
              role: "commentary",
              text: "I found the relevant form and I’m updating it now."
            }
          ],
          thinking: [
            {
              at: "2026-05-25T01:02:30.000Z",
              role: "thinking",
              text: "Thinking\nChecked the current form state."
            }
          ],
          turnId: "000001",
          user: {
            at: "2026-05-25T01:02:00.000Z",
            attachments: [
              {
                fileName: "report.md",
                size: 15379
              }
            ],
            role: "user",
            text: "Please check this."
          }
        },
        {
          assistant: null,
          turnId: "000002",
          user: {
            role: "user",
            text: "   "
          }
        }
      ]
    })).toEqual([
      {
        assistant: {
          at: "2026-05-25T01:03:00.000Z",
          role: "assistant",
          text: "Done."
        },
        commentary: [
          {
            at: "2026-05-25T01:02:45.000Z",
            messageId: "codex-progress-1",
            role: "commentary",
            text: "I found the relevant form and I’m updating it now."
          }
        ],
        messages: [
          {
            at: "2026-05-25T01:02:00.000Z",
            attachments: [
              {
                fileName: "report.md",
                size: 15379
              }
            ],
            role: "user",
            text: "Please check this."
          },
          {
            at: "2026-05-25T01:02:30.000Z",
            role: "thinking",
            text: "Checked the current form state."
          },
          {
            at: "2026-05-25T01:02:45.000Z",
            messageId: "codex-progress-1",
            role: "commentary",
            text: "I found the relevant form and I’m updating it now."
          },
          {
            at: "2026-05-25T01:03:00.000Z",
            role: "assistant",
            text: "Done."
          }
        ],
        thinking: [
          {
            at: "2026-05-25T01:02:30.000Z",
            role: "thinking",
            text: "Checked the current form state."
          }
        ],
        turnId: "000001",
        user: {
          at: "2026-05-25T01:02:00.000Z",
          attachments: [
            {
              fileName: "report.md",
              size: 15379
            }
          ],
          role: "user",
          text: "Please check this."
        }
      }
    ]);
  });

  it("drops generic thinking headings from thinking output", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          thinking: [
            {
              role: "thinking",
              text: "Thinking..."
            },
            {
              role: "thinking",
              text: "Thinking:\nVerifying artifact and guide reading"
            },
            {
              role: "thinking",
              text: "Thinking about whether to use cached output."
            }
          ],
          turnId: "000001"
        }
      ]
    })[0].thinking.map((message) => message.text)).toEqual([
      "Verifying artifact and guide reading",
      "Thinking about whether to use cached output."
    ]);
  });

  it("marks only the latest user-only turn as pending while Codex is awaited", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "Please revise this."
          }
        },
        {
          assistant: {
            role: "assistant",
            text: "Done."
          },
          turnId: "000002",
          user: {
            role: "user",
            text: "One more tweak."
          }
        },
        {
          turnId: "000003",
          user: {
            role: "user",
            text: "Make the file name lower case."
          }
        }
      ]
    }, {
      pending: true
    }).map((turn) => [
      turn.turnId,
      turn.pending === true
    ])).toEqual([
      ["000001", false],
      ["000002", false],
      ["000003", true]
    ]);
  });

  it("leaves user-only turns settled when the session is not awaiting Codex", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          turnId: "000001",
          user: {
            role: "user",
            text: "Make the file name lower case."
          }
        }
      ]
    }, {
      pending: false
    })).toEqual([
      {
        assistant: null,
        commentary: [],
        messages: [
          {
            at: "",
            role: "user",
            text: "Make the file name lower case."
          }
        ],
        thinking: [],
        turnId: "000001",
        user: {
          at: "",
          role: "user",
          text: "Make the file name lower case."
        }
      }
    ]);
  });

  it("keeps system turns distinct from user and assistant messages", () => {
    expect(normalizeConversationLog({
      conversationLog: [
        {
          system: {
            role: "system",
            text: "Session clone created."
          },
          turnId: "000001"
        }
      ]
    })).toEqual([
      {
        assistant: null,
        commentary: [],
        messages: [
          {
            at: "",
            role: "system",
            text: "Session clone created."
          }
        ],
        system: {
          at: "",
          role: "system",
          text: "Session clone created."
        },
        thinking: [],
        turnId: "000001",
        user: null
      }
    ]);
  });

  it("derives pending state from the active direct Codex turn", () => {
    expect(sessionAgentTurnActive({
      agentSession: {
        turn: { active: true }
      }
    })).toBe(true);
    expect(sessionAgentTurnActive({
      agentSession: {
        turn: { active: false }
      }
    })).toBe(false);
  });

  it("identifies a canonical completed turn for durable-history reconciliation", () => {
    expect(conversationLogCompletedTurnKey({
      agentSession: {
        turn: {
          active: false,
          id: "turn-1"
        }
      },
      revision: 8,
      sessionId: "session-1"
    })).toBe("session-1|8|turn-1");

    expect(conversationLogCompletedTurnKey({
      agentSession: {
        turn: {
          active: true,
          id: "turn-1"
        }
      },
      revision: 7,
      sessionId: "session-1"
    })).toBe("");

    expect(conversationLogCompletedTurnKey({
      revision: 8,
      sessionId: "session-1"
    })).toBe("");
  });

  it("reloads a completed integration request from the session notification without trusting event state", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1" });
    const model = scope.run(() => useVibe64ConversationLog({ session, conversation: suppliedConversation() }));
    const pendingTurn = { turnId: "000001", assistant: { role: "assistant", text: "Configure mail" },
      integrationSetup: { outcome: "pending", requestId: "a".repeat(64), integrationId: "mail" } };
    endpointMocks.resource.data.value.conversationLog = [pendingTurn];
    const notification = { payload: { sessionId: "session-1", reason: "integration-setup-completed" } };
    const listener = realtimeMocks.events.find((entry) => entry.matches(notification));
    expect(listener).toBeDefined();
    expect(listener.matches({ payload: { ...notification.payload, sessionId: "other" } })).toBe(false);
    await listener.onEvent(notification);
    expect(endpointMocks.resource.reload).toHaveBeenCalledTimes(1);
    expect(model.turns.value[0].integrationSetup.outcome).toBe("pending");
    endpointMocks.resource.data.value = { ...endpointMocks.resource.data.value, conversationLog: [
      { ...pendingTurn, integrationSetup: { ...pendingTurn.integrationSetup, outcome: "completed" } }
    ] };
    await nextTick();
    expect(model.turns.value[0].integrationSetup.outcome).toBe("completed");
    scope.stop();
  });

  it("refreshes only for selected-session events that can change durable chat text", () => {
    expect(conversationLogRealtimeShouldRefresh({ payload: {
      reason: "conversation-rewound", sessionId: "session-1"
    } }, "session-1")).toBe(true);
    expect(conversationLogRealtimeShouldRefresh({ payload: {
      reason: "session-assistant-selection-updated", sessionId: "session-1"
    } }, "session-1")).toBe(true);
    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-user-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-reasoning-summary",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-live-progress",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-thinking-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-assistant-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-agent-result",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-final-assistant-message",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "assistant-response-bundle",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-message-delivered",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "session-agent-message-delivered",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "opencode-provider-failure",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-turn-outcome",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(true);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-prompt-injected",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-turn-active",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "agent-terminal-closed",
        sessionId: "session-1"
      }
    }, "session-1")).toBe(false);

    expect(conversationLogRealtimeShouldRefresh({
      payload: {
        reason: "codex-app-server-terminal-assistant-message",
        sessionId: "session-2"
      }
    }, "session-1")).toBe(false);
  });

  it("reconciles supplied Main history when canonical completion misses realtime", async () => {
    const scope = effectScope();
    const active = ref(true);
    const session = ref({ sessionId: "session-1", revision: 7,
      agentSession: { turn: { active: true, id: "turn-1" } } });
    const user = { role: "user", messageId: "question", text: "Question" };
    const saved = { turnId: "000001", user, messages: [user],
      metadata: { assistantSelection: { engineId: "codex" } } };
    const live = { turnId: "stream:live-answer", messages: [
      { role: "assistant", messageId: "live-answer", text: "Partial", status: "inProgress" }
    ], pending: true };
    const conversation = { turns: ref([saved, live]), error: ref(""), accessDenied: ref(false),
      snapshot: ref({ status: "working" }), loading: ref(false), reload: vi.fn(async () => {
        const answer = { role: "assistant", messageId: "saved-answer", text: "Saved reply" };
        conversation.turns.value = [{ ...saved, assistant: answer, messages: [user, answer] }];
      }) };
    try {
      const model = scope.run(() => useVibe64ConversationLog({ active, session, conversation }));
      expect(endpointMocks.useEndpointResource).not.toHaveBeenCalled();
      expect(model.turns.value).toHaveLength(2);
      session.value = { sessionId: "session-1", revision: 8,
        agentSession: { turn: { active: false, id: "turn-1" } } };
      await nextTick();
      expect(conversation.reload).toHaveBeenCalledTimes(1);
      expect(model.turns.value).toHaveLength(1);
      expect(model.turns.value[0].assistant.messageId).toBe("saved-answer");
      expect(model.turns.value[0].metadata).toEqual(saved.metadata);
      expect(httpRequest).not.toHaveBeenCalled();
      active.value = false;
      session.value = { ...session.value, revision: 9 };
      await nextTick();
      expect(conversation.reload).toHaveBeenCalledTimes(1);
      scope.stop();
      session.value = { ...session.value, revision: 10 };
      await nextTick();
      expect(conversation.reload).toHaveBeenCalledTimes(1);
    } finally { scope.stop(); }
  });

  it("reconciles supplied Main completion once across its product event and session watcher", async () => {
    const scope = effectScope();
    const session = ref({ sessionId: "session-1", revision: 7,
      agentSession: { turn: { active: true, id: "turn-1" } } });
    const conversation = { turns: ref([]), error: ref(""), accessDenied: ref(false),
      snapshot: ref({ status: "working" }), loading: ref(false), reload: vi.fn(async () => null) };
    try {
      scope.run(() => useVibe64ConversationLog({ session, conversation }));
      const payload = { sessionId: "session-1", revision: 8, reason: "opencode-server-turn-idle",
        agentSession: { turn: { active: false, id: "turn-1" } } };
      const listener = realtimeMocks.events.find(entry => entry.matches({ payload }));
      expect(listener).toBeDefined();
      expect(listener.matches({ payload: { ...payload, sessionId: "other-session" } })).toBe(false);
      // Completion events carry no live stream: the native subscription does.
      expect(listener.matches({ payload: { ...payload, reason: "claude-stream-turn-idle" } })).toBe(true);
      await listener.onEvent({ payload });
      session.value = payload;
      await nextTick();
      expect(conversation.reload).toHaveBeenCalledTimes(1);
      expect(endpointMocks.useEndpointResource).not.toHaveBeenCalled();
      expect(httpRequest).not.toHaveBeenCalled();
    } finally { scope.stop(); }
  });

  {
    const scopeIdentity = { projectSlug: "project-a" };
    it("retargets supplied Main observation only for its own selection invalidation", async () => {
      const scope = effectScope();
      const session = ref({ sessionId: "session-1" });
      const draft = ref("Keep these unsent words");
      const pending = [{ id: "pending", text: "Already queued" }];
      const earlier = { turnId: "000001", user: { messageId: "old", text: "Loaded earlier" } };
      const conversation = { turns: ref([earlier]), draft, delivery: { state: { messages: pending } },
        error: ref(""), accessDenied: ref(false), snapshot: ref({ status: "ready" }), loading: ref(false), reload: vi.fn() };
      try {
        scope.run(() => useVibe64ConversationLog({ ...scopeIdentity, session, conversation }));
        const payload = { ...scopeIdentity, reason: "session-assistant-selection-updated", sessionId: "session-1" };
        const listener = realtimeMocks.events.find(entry => entry.matches({ payload }));
        expect(listener).toBeDefined();
        expect(listener.matches({ payload: { ...payload, sessionId: "another" } })).toBe(false);
        expect(listener.matches({ payload: { ...payload, projectSlug: "another-project" } })).toBe(false);
        expect(listener.matches({ payload: { ...payload, projectSlug: "", learningAttemptId: "attempt-a" } })).toBe(false);
        await listener.onEvent({ payload });
        expect(conversation.reload).toHaveBeenCalledExactlyOnceWith({ resubscribe: true });
        expect(draft.value).toBe("Keep these unsent words");
        expect(conversation.delivery.state.messages).toBe(pending);
        expect(conversation.turns.value[0]).toEqual(earlier);
        expect(httpRequest).not.toHaveBeenCalled();
      } finally { scope.stop(); }
    });
  }

});
