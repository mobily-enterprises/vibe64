import {
  DASHBOARD_PATH,
  abandonedArchiveSession,
  bootstrapPayload,
  blockedAppSetupPayload,
  blockedConnectionsPayload,
  blockedBootstrapPayload,
  blockedTargetAppPayload,
  completedArchiveSession,
  currentAppPayload,
  sessionRuntimeRoot,
  targetRoot,
  readyConnectionsPayload,
  readyAppSetupPayload,
  readyBootstrapPayload,
  readyProjectSelectionPayload,
  readyProjectConfigPayload,
  readyProjectTypePayload,
  readyTargetAppPayload,
  targetScriptsPayload
} from "../base-shell-data";
import {
  fulfillJson,
  fulfillSse,
  routeApiEndpoint,
  setupReadinessPayload
} from "./http";

async function mockAuthenticatedApp(page) {
  await page.route("**/api/auth/state", async (route) => {
    await fulfillJson(route, {
      authenticated: true,
      ok: true,
      setupRequired: false,
      user: {
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

async function mockProjectTools(page) {
  const payload = {
    ok: true,
    tools: []
  };
  await routeApiEndpoint(page, "/vibe64/tools", async (route) => {
    await fulfillJson(route, payload);
  });
  await routeApiEndpoint(page, "/studio/vibe64/tools", async (route) => {
    await fulfillJson(route, payload);
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
    adapterId: "jskit",
    environment: "dev",
    generatedFiles: {
      activeSessionSources: [
        {
          label: "session-renderer",
          path: `${sessionRuntimeRoot("session-renderer")}/source`,
          rootKind: "worktree",
          sessionId: "session-renderer",
          synced: true,
          targets: [
            {
              exists: true,
              generated: true,
              generatedAt: "2026-06-21T00:00:00.000Z",
              path: `${sessionRuntimeRoot("session-renderer")}/source/.env`,
              relativePath: ".env",
              status: "synced",
              synced: true
            }
          ]
        }
      ],
      lastGeneratedAt: "2026-06-21T00:00:00.000Z",
      materialization: [],
      roots: [
        {
          label: "Project root",
          path: "/workspace/example-target-app",
          rootKind: "project-root",
          synced: true,
          targets: [
            {
              exists: true,
              generated: true,
              generatedAt: "2026-06-21T00:00:00.000Z",
              path: "/workspace/example-target-app/.env",
              relativePath: ".env",
              status: "synced",
              synced: true
            }
          ]
        },
        {
          label: "session-renderer",
          path: `${sessionRuntimeRoot("session-renderer")}/source`,
          rootKind: "worktree",
          sessionId: "session-renderer",
          synced: true,
          targets: [
            {
              exists: true,
              generated: true,
              generatedAt: "2026-06-21T00:00:00.000Z",
              path: `${sessionRuntimeRoot("session-renderer")}/source/.env`,
              relativePath: ".env",
              status: "synced",
              synced: true
            }
          ]
        }
      ],
      synced: true,
      targets: [".env"]
    },
    generatedTargets: [".env"],
    ok: true,
    publicEnvPrefixes: ["VITE_"],
    records: [
      {
        editable: false,
        key: "APP_PUBLIC_URL",
        required: true,
        source: "jskit-local-default",
        value: {
          present: true,
          preview: "http://localhost:3000",
          secret: false
        }
      },
      {
        editable: true,
        key: "OPENAI_API_KEY",
        required: true,
        source: "user",
        value: {
          present: true,
          preview: "********",
          secret: true
        }
      },
      {
        editable: true,
        key: "HOME_ASSISTANT_AI_API_KEY",
        required: true,
        source: "user",
        value: {
          present: false,
          preview: "",
          secret: true
        }
      }
    ],
    systemRecords: [
      {
        editable: false,
        key: "JSKIT_AUTH_SUPABASE_PUBLISHABLE_KEY",
        required: false,
        source: "system",
        value: {
          present: true,
          preview: "********",
          secret: true
        }
      },
      {
        editable: false,
        key: "JSKIT_AUTH_SUPABASE_URL",
        required: false,
        source: "system",
        value: {
          present: true,
          preview: "https://devref.supabase.co",
          secret: false
        }
      }
    ],
    unavailable: null
  }
};

async function mockEmptySessions(page) {
  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    await fulfillJson(route, {
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 0
      },
      ok: true,
      sessions: [],
      stepDefinitions: []
    });
  });
}

function capabilitiesPayload({
  connections = readyConnectionsPayload,
  setup = setupReadinessPayload({
    stages: [
      readyBootstrapPayload,
      readyTargetAppPayload,
      readyAppSetupPayload
    ]
  })
} = {}) {
  const connectionRows = Array.isArray(connections.connections) ? connections.connections : [];
  const codex = connectionRows.find((connection) => connection.id === "codex") || {
    connected: false,
    id: "codex",
    label: "Codex",
    message: "Codex is not authenticated for Studio."
  };
  const github = connectionRows.find((connection) => connection.id === "github") || {
    connected: false,
    id: "github",
    label: "GitHub",
    message: "GitHub CLI is not authenticated for Studio."
  };
  const setupReady = setup.ready === true;
  const aiReady = codex.connected === true;
  const githubReady = github.connected === true;
  const setupRoute = `${DASHBOARD_PATH}/setup`;
  const fix = (route: string, label: string) => ({
    label,
    route
  });
  const capability = (enabled: boolean, reason = "", route = "") => ({
    enabled,
    fix: enabled || !route ? null : fix(route, "Open Setup"),
    reason: enabled ? "" : reason
  });
  const setupReason = setup.message || "Finish automatic setup before using this capability.";
  const createSessionReason = !aiReady
    ? "Choose and authenticate an AI provider before starting a session."
    : !githubReady
      ? "Connect GitHub before starting GitHub-backed session work."
      : setupReason;

  return {
    capabilities: {
      chat: capability(aiReady && setupReady, aiReady ? setupReason : "Finish local editor connection setup before using chat.", setupRoute),
      createSession: capability(aiReady && githubReady && setupReady, createSessionReason, setupRoute),
      githubWorkflow: capability(githubReady, "Finish git connection setup before using GitHub issue, pull request, or merge actions.", setupRoute),
      home: capability(true),
      preview: capability(setupReady, setupReason, setupRoute),
      runScripts: capability(true)
    },
    connections: {
      ai: {
        message: aiReady ? "Codex is selected and authenticated." : codex.message,
        providers: [
          {
            ...codex,
            ready: aiReady,
            selected: true
          }
        ],
        ready: aiReady,
        selectedProviderId: "codex"
      },
      github: {
        ...github,
        ready: githubReady
      },
      ready: aiReady && githubReady,
      rows: connectionRows
    },
    ok: true,
    setup,
    targetRoot,
    updatedAt: "2026-06-02T00:00:00.000Z"
  };
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
  await routeApiEndpoint(page, "/studio/current-app/capabilities", async (route) => {
    await fulfillJson(route, capabilitiesPayload());
  });
  await routeApiEndpoint(page, "/vibe64/project-type", async (route) => {
    await fulfillJson(route, readyProjectTypePayload);
  });
  await routeApiEndpoint(page, "/vibe64/project-config", async (route) => {
    await fulfillJson(route, readyProjectConfigPayload);
  });
  await routeApiEndpoint(page, "/vibe64/env", async (route) => {
    await fulfillJson(route, envPayload);
  });
  await routeApiEndpoint(page, "/vibe64/env/materialize", async (route) => {
    await fulfillJson(route, envPayload);
  });
  await routeApiEndpoint(page, "/vibe64/env/user-values", async (route) => {
    await fulfillJson(route, envPayload);
  });
  await mockProjectTools(page);
  await mockProjectRuntime(page);
}

async function mockSetupReadiness(page, payload) {
  await routeApiEndpoint(page, "/studio/current-app/setup-readiness", async (route) => {
    await fulfillJson(route, payload);
  });
  await routeApiEndpoint(page, "/studio/current-app/setup-readiness/stream", async (route) => {
    await fulfillSse(route, payload, "stages");
  });
}

async function mockSetupGateReady(page) {
  await mockSetupReadiness(page, setupReadinessPayload({
    stages: [
      readyBootstrapPayload,
      readyTargetAppPayload,
      readyAppSetupPayload
    ]
  }));
  await routeApiEndpoint(page, "/studio/studio-setup", async (route) => {
    await fulfillJson(route, readyBootstrapPayload);
  });
  await routeApiEndpoint(page, "/studio/adapter-setup", async (route) => {
    await fulfillJson(route, readyTargetAppPayload);
  });
  await routeApiEndpoint(page, "/studio/project-setup", async (route) => {
    await fulfillJson(route, readyAppSetupPayload);
  });
}

async function mockProtectedRouteReady(page) {
  await mockProjectGateReady(page);
  await mockSetupGateReady(page);
}

async function mockBootstrapBlocked(page) {
  await mockProjectGateReady(page);
  const setup = setupReadinessPayload({
    currentStage: {
      id: "studio-setup",
      label: "Studio Setup"
    },
    message: "Studio Setup is not ready.",
    ready: false,
    stages: [
      blockedBootstrapPayload,
      readyTargetAppPayload,
      readyAppSetupPayload
    ]
  });
  await mockSetupReadiness(page, setup);
  await routeApiEndpoint(page, "/studio/current-app/capabilities", async (route) => {
    await fulfillJson(route, capabilitiesPayload({
      setup
    }));
  });
  await routeApiEndpoint(page, "/studio/studio-setup", async (route) => {
    await fulfillJson(route, blockedBootstrapPayload);
  });
  await routeApiEndpoint(page, "/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, blockedBootstrapPayload);
  });
  await mockEmptySessions(page);
}

async function mockTargetAppBlocked(page) {
  await mockProjectGateReady(page);
  const setup = setupReadinessPayload({
    currentStage: {
      id: "adapter-setup",
      label: "Adapter Setup"
    },
    message: "Adapter Setup is not ready.",
    ready: false,
    stages: [
      readyBootstrapPayload,
      blockedTargetAppPayload,
      readyAppSetupPayload
    ]
  });
  await mockSetupReadiness(page, setup);
  await routeApiEndpoint(page, "/studio/current-app/capabilities", async (route) => {
    await fulfillJson(route, capabilitiesPayload({
      setup
    }));
  });
  await routeApiEndpoint(page, "/studio/studio-setup", async (route) => {
    await fulfillJson(route, readyBootstrapPayload);
  });
  await routeApiEndpoint(page, "/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await routeApiEndpoint(page, "/studio/adapter-setup", async (route) => {
    await fulfillJson(route, blockedTargetAppPayload);
  });
  await routeApiEndpoint(page, "/studio/adapter-setup/stream", async (route) => {
    await fulfillSse(route, blockedTargetAppPayload);
  });
}

async function mockStudioReady(page) {
  await mockProjectGateReady(page);
  await routeApiEndpoint(page, "/studio/studio-setup", async (route) => {
    await fulfillJson(route, readyBootstrapPayload);
  });
  await routeApiEndpoint(page, "/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await routeApiEndpoint(page, "/studio/adapter-setup", async (route) => {
    await fulfillJson(route, readyTargetAppPayload);
  });
  await routeApiEndpoint(page, "/studio/adapter-setup/stream", async (route) => {
    await fulfillSse(route, readyTargetAppPayload);
  });
  await routeApiEndpoint(page, "/studio/project-setup/stream", async (route) => {
    await fulfillSse(route, readyAppSetupPayload, "stages");
  });
  await routeApiEndpoint(page, "/studio/project-setup", async (route) => {
    await fulfillJson(route, readyAppSetupPayload);
  });
  await mockCurrentAppInspection(page);
}

async function mockConnectionsBlocked(page) {
  await mockProjectGateReady(page);
  await mockSetupReadiness(page, setupReadinessPayload({
    currentStage: null,
    message: "",
    ready: true,
    stages: [
      readyBootstrapPayload,
      readyTargetAppPayload,
      readyAppSetupPayload
    ]
  }));
  await routeApiEndpoint(page, "/studio/current-app/capabilities", async (route) => {
    await fulfillJson(route, capabilitiesPayload({
      connections: blockedConnectionsPayload
    }));
  });
  await routeApiEndpoint(page, "/studio/current-app", async (route) => {
    await fulfillJson(route, currentAppPayload);
  });
  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    await fulfillJson(route, {
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 0
      },
      ok: true,
      sessions: [],
      stepDefinitions: []
    });
  });
}

async function mockCurrentAppInspection(page) {
  await mockProtectedRouteReady(page);
  await routeApiEndpoint(page, "/studio/current-app", async (route) => {
    await fulfillJson(route, currentAppPayload);
  });
  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    await fulfillJson(route, {
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 0
      },
      ok: true,
      sessions: [],
      stepDefinitions: []
    });
  });
  await mockTargetScripts(page);
}

async function mockTargetScripts(page, {
  terminalInputs = [],
  terminalStarts = []
}: {
  terminalInputs?: string[];
  terminalStarts?: string[];
} = {}) {
  await mockProtectedRouteReady(page);
  let currentPayload = JSON.parse(JSON.stringify(targetScriptsPayload));

  await page.exposeFunction("__recordStudioTargetScriptTerminalInput", ({ data }: { data: string }) => {
    terminalInputs.push(String(data || ""));
  });
  await page.addInitScript((options) => {
    const studioWindow = window as unknown as {
      __recordStudioTargetScriptTerminalInput: (input: { data: string }) => void;
      WebSocket: typeof WebSocket;
    };
    const OriginalWebSocket = studioWindow.WebSocket;

    class MockStudioWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState: number;
      terminalSessionId: string;
      url: string;

      constructor(url) {
        super();
        this.url = String(url || "");
        const pathname = new URL(this.url).pathname;
        const match = /\/target-script-terminal\/([^/]+)\/ws/u.exec(pathname);
        if (!match) {
          return new OriginalWebSocket(url);
        }
        this.readyState = MockStudioWebSocket.CONNECTING;
        this.terminalSessionId = decodeURIComponent(match[1]);
        window.setTimeout(() => {
          const scriptId = this.terminalSessionId.replace(/^target-term-/u, "");
          this.readyState = MockStudioWebSocket.OPEN;
          this.dispatchEvent(new Event("open"));
          this.__emit({
            type: "snapshot",
            session: {
              ok: true,
              id: this.terminalSessionId,
              status: "running",
              commandPreview: options.commandByScriptId[scriptId] || scriptId,
              output: `Started ${this.terminalSessionId}.`
            }
          });
        }, 0);
      }

      send(rawMessage) {
        const message = JSON.parse(String(rawMessage || "{}"));
        if (message.type === "input") {
          studioWindow.__recordStudioTargetScriptTerminalInput({
            data: String(message.data || "")
          });
        }
      }

      close() {
        this.readyState = MockStudioWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent("close"));
      }

      __emit(message) {
        this.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify(message)
        }));
      }
    }
    studioWindow.WebSocket = MockStudioWebSocket as unknown as typeof WebSocket;
  }, {
    commandByScriptId: Object.fromEntries(targetScriptsPayload.scripts.map((script) => [script.id, script.command]))
  });

  function applyStars(scriptIds: string[]) {
    const stars = new Set(scriptIds);
    currentPayload = {
      ...currentPayload,
      config: {
        exists: true,
        path: "runtime-config/current-app/starred_scripts"
      },
      starredScriptIds: scriptIds,
      scripts: currentPayload.scripts.map((script) => ({
        ...script,
        starred: stars.has(script.id)
      }))
    };
  }

  await routeApiEndpoint(page, "/studio/current-app/target-scripts", async (route) => {
    await fulfillJson(route, currentPayload);
  }, { prefix: true });
  await routeApiEndpoint(page, "/studio/current-app/target-scripts/starred", async (route) => {
    if (route.request().method() === "DELETE") {
      currentPayload = JSON.parse(JSON.stringify(targetScriptsPayload));
      await fulfillJson(route, currentPayload);
      return;
    }
    applyStars(route.request().postDataJSON().scriptIds || []);
    await fulfillJson(route, currentPayload);
  }, { prefix: true });
  await routeApiEndpoint(page, "/studio/current-app/target-script-terminal", async (route) => {
    const scriptId = String(route.request().postDataJSON().scriptId || "");
    const script = currentPayload.scripts.find((item) => item.id === scriptId) || {};
    terminalStarts.push(scriptId);
    await fulfillJson(route, {
      ok: true,
      id: `target-term-${scriptId}`,
      status: "running",
      commandPreview: script.command || scriptId,
      output: ""
    });
  });
  await routeApiEndpoint(page, "/studio/current-app/target-script-terminal", async (route) => {
    await fulfillJson(route, {
      closed: true,
      ok: true
    });
  }, { children: true });
}

async function mockSessionHistoryArchives(page, archiveRequests = []) {
  await mockProtectedRouteReady(page);
  await routeApiEndpoint(page, "/studio/current-app", async (route) => {
    await fulfillJson(route, currentAppPayload);
  });
  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    const url = new URL(route.request().url());
    archiveRequests.push(`${url.pathname}${url.search}`);
    await fulfillJson(route, {
      limits: {
        maxOpenSessions: 5,
        openSessionCount: 0
      },
      ok: true,
      sessions: [completedArchiveSession, abandonedArchiveSession],
      stepDefinitions: []
    });
  });
  await mockTargetScripts(page);
}

async function mockAppSetupBlocked(page) {
  await mockProjectGateReady(page);
  const setup = setupReadinessPayload({
    currentStage: {
      id: "project-setup",
      label: "Project Setup"
    },
    message: "Project Setup is not ready.",
    ready: false,
    stages: [
      readyBootstrapPayload,
      readyTargetAppPayload,
      blockedAppSetupPayload
    ]
  });
  await mockSetupReadiness(page, setup);
  await routeApiEndpoint(page, "/studio/current-app/capabilities", async (route) => {
    await fulfillJson(route, capabilitiesPayload({
      setup
    }));
  });
  await routeApiEndpoint(page, "/studio/studio-setup", async (route) => {
    await fulfillJson(route, readyBootstrapPayload);
  });
  await routeApiEndpoint(page, "/studio/studio-setup/stream", async (route) => {
    await fulfillSse(route, readyBootstrapPayload);
  });
  await routeApiEndpoint(page, "/studio/adapter-setup", async (route) => {
    await fulfillJson(route, readyTargetAppPayload);
  });
  await routeApiEndpoint(page, "/studio/adapter-setup/stream", async (route) => {
    await fulfillSse(route, readyTargetAppPayload);
  });
  await routeApiEndpoint(page, "/studio/project-setup", async (route) => {
    await fulfillJson(route, blockedAppSetupPayload);
  });
  await routeApiEndpoint(page, "/studio/project-setup/stream", async (route) => {
    await fulfillSse(route, blockedAppSetupPayload, "stages");
  });
  await mockEmptySessions(page);
}

export {
  mockConnectionsBlocked,
  mockAppSetupBlocked,
  mockBootstrapBlocked,
  mockCurrentAppInspection,
  mockProjectGateReady,
  mockProtectedRouteReady,
  mockSessionHistoryArchives,
  mockSetupGateReady,
  mockStudioReady,
  mockTargetAppBlocked,
  mockTargetScripts
};
