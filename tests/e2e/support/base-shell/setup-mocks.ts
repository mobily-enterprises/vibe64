import {
  archivedHistorySession,
  bootstrapPayload,
  currentAppPayload,
  targetRoot,
  readyProjectSelectionPayload
} from "../base-shell-data";
import {
  fulfillJson,
  routeApiEndpoint
} from "./http";

async function mockAuthenticatedApp(page) {
  await page.route("**/api/auth/state", async (route) => {
    await fulfillJson(route, {
      authenticated: true,
      ok: true,
      setupRequired: false,
      user: {
        uid: "test-owner",
        username: "test-owner",
        email: "owner@example.com",
        gravatarUrl: "https://www.gravatar.com/avatar/00000000000000000000000000000000?d=identicon",
        role: "owner"
      }
    });
  });
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;

    class MockLifecycleWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = MockLifecycleWebSocket.CONNECTING;
      url = "";

      constructor(url) {
        super();
        this.url = String(url || "");
        const pathname = new URL(this.url, window.location.href).pathname;
        if (pathname !== "/api/studio/browser-lifecycle/ws") {
          return new OriginalWebSocket(url);
        }
        window.setTimeout(() => {
          this.readyState = MockLifecycleWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("message", {
            data: JSON.stringify({
              state: "active",
              type: "state"
            })
          }));
        }, 0);
      }

      send() {}

      close() {
        this.readyState = MockLifecycleWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }

    window.WebSocket = MockLifecycleWebSocket as unknown as typeof WebSocket;
  });
}

async function mockProjectRuntime(page) {
  await routeApiEndpoint(page, "/vibe64/project-runtime/open", async (route) => {
    await fulfillJson(route, {
      ok: true,
      runtime: {
        open: true,
        reason: "unit-open",
        targetRoot
      },
      targetRoot
    });
  });
  await routeApiEndpoint(page, "/vibe64/project-runtime/close", async (route) => {
    await fulfillJson(route, {
      ok: true
    });
  });
}

const envPayload = {
  ok: true,
  env: {
    environment: "dev",
    records: [],
    unavailable: null
  }
};

const accountsPayload = {
  accounts: [
    {
      connected: true,
      id: "codex",
      label: "Codex",
      required: true,
      status: "connected"
    },
    {
      connected: true,
      id: "github",
      label: "GitHub",
      required: true,
      status: "connected"
    }
  ],
  blockedReason: "",
  ok: true,
  ready: true
};

const mainAiSelection = {
  schema: "vibe64.assistant-selection.v1", engineId: "codex", agentId: "codex", modelProviderId: "openai",
  modelId: "gpt-5.5", variantId: "", catalogRevision: `sha256:${"a".repeat(64)}`, selectionSource: "recommended"
};

// The AI setup read: main chat's AI alone for the light "main" view, or both
// setups with each owner role's choices for Models.
function modelRoutingPayload(view) {
  if (view === "main") return { ok: true, revision: 1, canConfigure: true, mainSelection: mainAiSelection };
  const choices = [{ ...mainAiSelection, label: "GPT-5.5", engineLabel: "Codex", providerLabel: "OpenAI",
    accessLabel: "Workspace use", available: true, variants: [] }];
  const role = { configured: true, value: mainAiSelection, effective: mainAiSelection, recommendation: mainAiSelection, choices, error: "" };
  return {
    ok: true, revision: 1, canConfigure: true, team: { available: false, ownerName: "", memberCount: 0 },
    engines: [{ engineId: "codex", label: "Codex", connected: true, error: "" }],
    setups: { owner: { roles: { senior: role, junior: role } }, nonOwner: { roles: {} } },
    viewer: { senior: { available: true, effectiveSelection: mainAiSelection } }
  };
}

async function mockEmptySessions(page) {
  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    await fulfillJson(route, {
      limits: {
        openSessionCount: 0
      },
      creation: { canCreate: true, showCreateAction: true, disabledReason: "" },
      ok: true,
      sessions: []
    });
  });
}

async function mockShellStatusEndpoints(page) {
  await routeApiEndpoint(page, "/vibe64/accounts", async (route) => {
    await fulfillJson(route, accountsPayload);
  });
  await routeApiEndpoint(page, "/vibe64/accounts/model-routing", async (route) => {
    await fulfillJson(route, modelRoutingPayload(new URL(route.request().url()).searchParams.get("view")));
  });
  await mockEmptySessions(page);
}

async function mockProjectGateReady(page) {
  await mockAuthenticatedApp(page);
  await page.route("**/api/bootstrap", async (route) => {
    await fulfillJson(route, bootstrapPayload);
  });
  await routeApiEndpoint(page, "/vibe64/projects", async (route) => {
    await fulfillJson(route, readyProjectSelectionPayload);
  });
  await routeApiEndpoint(page, "/studio/current-app", async (route) => {
    await fulfillJson(route, currentAppPayload);
  });
  await routeApiEndpoint(page, "/vibe64/env", async (route) => {
    await fulfillJson(route, envPayload);
  });
  await routeApiEndpoint(page, "/vibe64/env/user-values", async (route) => {
    await fulfillJson(route, envPayload);
  });
  await mockProjectRuntime(page);
  await mockShellStatusEndpoints(page);
}

async function mockCurrentAppInspection(page) {
  await mockProjectGateReady(page);
}

async function mockSessionHistoryArchives(page, archiveRequests = []) {
  await mockProjectGateReady(page);
  await routeApiEndpoint(page, "/vibe64/sessions/open-session", async (route) => {
    await fulfillJson(route, {
      ok: true,
      sessionId: "open-session",
      status: "active"
    });
  });
  await routeApiEndpoint(page, `/vibe64/sessions/${archivedHistorySession.sessionId}`, async (route) => {
    await fulfillJson(route, {
      ...archivedHistorySession,
      ok: true
    });
  });
  await routeApiEndpoint(page, `/vibe64/sessions/${archivedHistorySession.sessionId}/conversation-log`, async (route) => {
    await fulfillJson(route, {
      conversationLog: [
        {
          assistant: {
            at: "2026-05-12T03:15:00.000Z",
            role: "assistant",
            text: "I stopped before finishing this session."
          },
          turnId: `${archivedHistorySession.sessionId}-turn-1`,
          user: {
            at: "2026-05-12T03:14:00.000Z",
            role: "user",
            text: "Stop this session."
          }
        }
      ],
      ok: true,
      pagination: {
        count: 1,
        hasMoreBefore: false,
        limit: 20,
        newestTurnId: `${archivedHistorySession.sessionId}-turn-1`,
        oldestTurnId: `${archivedHistorySession.sessionId}-turn-1`,
        totalTurnCount: 1
      },
      revision: 1,
      sessionId: archivedHistorySession.sessionId
    });
  });
  await routeApiEndpoint(page, "/vibe64/sessions/archived", async (route) => {
    const url = new URL(route.request().url());
    archiveRequests.push(`${url.pathname}${url.search}`);
    await fulfillJson(route, {
      ok: true,
      sessions: [archivedHistorySession]
    });
  });
}

export {
  mockCurrentAppInspection,
  mockProjectGateReady,
  mockSessionHistoryArchives
};
