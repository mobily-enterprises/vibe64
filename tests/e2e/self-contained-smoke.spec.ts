import { expect, test, type Page, type Route } from "@playwright/test";

import {
  DASHBOARD_PATH,
  DEVELOPMENT_PATH,
  SCOPED_API_PREFIX
} from "./support/base-shell-data";

const targetRoot = "/workspace/example-target-app";
const savedProjectConfigValues = {
  jskit_database_runtime: "none"
};

test("home loads through a self-contained mocked Studio shell", async ({ page }) => {
  await mockReadyStudioShell(page);

  await page.goto(DEVELOPMENT_PATH);

  await expect(page).toHaveURL(developmentUrlPattern());
  await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tools" })).toHaveCount(0);
  await page.goto(`${DASHBOARD_PATH}/history`);
  await expect(page.getByRole("heading", { level: 1, name: "Session History", exact: true })).toBeVisible();
  await expect(page.getByText("Review completed and abandoned Vibe64 sessions.", { exact: true })).toHaveCount(0);
  await page.goto(DEVELOPMENT_PATH);
  await expect(page).toHaveURL(developmentUrlPattern());
  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible();
  await page.getByRole("button", { name: "New Session" }).click({ force: true });
  await expect(page.getByText("Session type")).toBeVisible();
  await expect(page.getByText("Make improvements", { exact: true })).toBeVisible();
  await expect(page.getByText("General coding", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Documentation/non code maintenance", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Non-commit maintenance", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(developmentUrlPattern());
});

test("safe read failures use JSKIT shell recovery retry", async ({ page }) => {
  await mockReadyStudioShell(page, {
    failInitialGetCounts: {
      "/api/vibe64/projects": 9
    }
  });

  await page.goto(DEVELOPMENT_PATH);

  const recoveryMessage = "Projects could not reach the server or network. Check the connection and try again.";
  const recoveryBanner = page.locator(".shell-error-host__banner").filter({
    hasText: recoveryMessage
  });
  await expect(recoveryBanner).toBeVisible({
    timeout: 15_000
  });

  await recoveryBanner.getByRole("button", { name: "Retry" }).click();

  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible({
    timeout: 15_000
  });
  await expect(recoveryBanner).toHaveCount(0);
});

function escapedPathPattern(pathValue: string) {
  return String(pathValue || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function developmentUrlPattern() {
  return new RegExp(`${escapedPathPattern(DEVELOPMENT_PATH)}$`, "u");
}

function dashboardUrlPattern(routePath: string) {
  return new RegExp(`${escapedPathPattern(DASHBOARD_PATH)}/${routePath}/?$`, "u");
}

type MockReadyStudioShellOptions = {
  failInitialGetCounts?: Record<string, number>;
};

async function mockReadyStudioShell(page: Page, options: MockReadyStudioShellOptions = {}) {
  const failInitialGetCounts = new Map(Object.entries(options.failInitialGetCounts || {}));
  let projectConfigResolved = false;
  let markProjectConfigResolved = () => undefined;
  const projectConfigReady = new Promise<void>((resolve) => {
    markProjectConfigResolved = () => {
      if (projectConfigResolved) {
        return;
      }
      projectConfigResolved = true;
      resolve();
    };
  });
  const connectionsReadyPayload = {
    connections: [
      {
        connected: true,
        id: "codex",
        label: "Codex",
        status: "connected"
      },
      {
        connected: true,
        id: "github",
        label: "GitHub",
        status: "connected"
      }
    ],
    ok: true,
    ready: true
  };
  const setupReadinessReadyPayload = {
    currentStage: null,
    message: "",
    ready: true,
    stages: [
      {
        checks: [],
        ok: true,
        ready: true
      },
      {
        checks: [],
        ok: true,
        ready: true
      },
      {
        ok: true,
        ready: true,
        stages: []
      }
    ]
  };
  const capabilitiesPayload = {
    capabilities: {
      chat: { enabled: true, fix: null, reason: "" },
      createSession: { enabled: true, fix: null, reason: "" },
      githubWorkflow: { enabled: true, fix: null, reason: "" },
      home: { enabled: true, fix: null, reason: "" },
      preview: { enabled: true, fix: null, reason: "" },
      runScripts: { enabled: true, fix: null, reason: "" }
    },
    connections: {
      ai: {
        message: "Codex is selected and authenticated.",
        providers: [
          {
            ...connectionsReadyPayload.connections[0],
            ready: true,
            selected: true
          }
        ],
        ready: true,
        selectedProviderId: "codex"
      },
      github: {
        ...connectionsReadyPayload.connections[1],
        ready: true
      },
      ready: true,
      rows: connectionsReadyPayload.connections
    },
    ok: true,
    setup: setupReadinessReadyPayload,
    targetRoot,
    updatedAt: "2026-06-02T00:00:00.000Z"
  };
  const projectToolsPayload = {
    ok: true,
    tools: [
      {
        confirmationMessage: "",
        description: "Exercise parameter collection without starting a terminal.",
        disabledReason: "",
        enabled: true,
        id: "parameterized_smoke_tool",
        label: "Parameterized smoke tool",
        parameters: [
          {
            defaultValue: "cache",
            description: "Select the target scope.",
            id: "scope",
            label: "Scope",
            options: [
              {
                label: "Cache",
                value: "cache"
              },
              {
                label: "Database",
                value: "database"
              }
            ],
            required: true,
            type: "enum"
          }
        ],
        requiresConfirmation: false,
        type: "command"
      }
    ]
  };
  const apiPayloads = new Map<string, unknown>([
    [
      "/api/vibe64/accounts",
      {
        accounts: [],
        blockedReason: "",
        ok: true,
        providerScopes: {
          codex: "app",
          github: "user"
        },
        ready: true
      }
    ],
    [
      "/api/vibe64/managed-app-auth",
      {
        account: {
          connected: false,
          message: "Supabase Personal Access Token is not configured.",
          observed: "Supabase PAT: missing. Dev project: missing. Prod project: missing.",
          required: false,
          status: "not_connected",
          syncManaged: true
        },
        managed: true,
        method: "pat",
        ok: true,
        organizationSlug: "",
        organizations: [],
        projects: {},
        provider: "supabase",
        ready: false,
        regionGroup: "americas",
        smtp: {
          fromEmail: "",
          fromName: "",
          host: "",
          passwordPresent: false,
          port: "",
          ready: false,
          username: ""
        },
        tokenPresent: false
      }
    ],
    [
      "/api/bootstrap",
      {
        app: {
          features: {
            assistantEnabled: false,
            assistantRequiredPermission: "",
            socialEnabled: false,
            socialFederationEnabled: false
          }
        },
        definition: null,
        requestMeta: {
          hasRequest: false
        },
        session: {
          authenticated: false,
          oauthDefaultProvider: null,
          oauthProviders: []
        },
        surfaceAccess: {},
        userSettings: null
      }
    ],
    [
      "/api/vibe64/projects",
      {
        currentProject: {
          external: true,
          name: "example-target-app",
          path: targetRoot,
          selected: true,
          slug: "example-target-app",
          source: "external"
        },
        hasSelection: true,
        ok: true,
        projects: [
          {
            external: true,
            name: "example-target-app",
            path: targetRoot,
            selected: true,
            slug: "example-target-app",
            source: "external"
          }
        ],
        projectsRoot: "/workspace",
        targetRoot
      }
    ],
    [
      "/api/vibe64/project-type",
      {
        ok: true,
        projectType: {
          adapter: {
            id: "jskit",
            label: "JSKIT target adapter"
          },
          availableProjectTypes: [
            {
              enabled: true,
              id: "jskit",
              label: "JSKIT AI"
            }
          ],
          errorCode: "",
          message: "",
          path: `${targetRoot}/.vibe64/project_type`,
          projectType: "jskit",
          ready: true,
          status: "ready",
          targetRoot
        }
      }
    ],
    [
      "/api/vibe64/project-config",
      {
        config: {
          adapter: {
            id: "jskit",
            label: "JSKIT target adapter"
          },
          configRoot: `${targetRoot}/.vibe64/config`,
          defaults: savedProjectConfigValues,
          fields: [],
          fieldValues: Object.fromEntries(
            Object.entries(savedProjectConfigValues).map(([fieldId, value]) => [
              fieldId,
              {
                defaultValue: value,
                filePath: `${targetRoot}/.vibe64/config/${fieldId}`,
                invalid: null,
                saved: true,
                value
              }
            ])
          ),
          helperPath: `${targetRoot}/.vibe64-local/runtime/vibe64-config.sh`,
          invalid: [],
          message: "",
          missing: [],
          projectType: "jskit",
          ready: true,
          runtimeRoot: `${targetRoot}/.vibe64-local/runtime`,
          sections: [],
          values: savedProjectConfigValues
        },
        ok: true
      }
    ],
    [
      "/api/studio/studio-setup",
      {
        checks: [],
        ok: true,
        ready: true
      }
    ],
    [
      "/api/studio/adapter-setup",
      {
        checks: [],
        ok: true,
        ready: true
      }
    ],
    [
      "/api/studio/project-setup",
      {
        ok: true,
        ready: true,
        stages: []
      }
    ],
    [
      "/api/studio/current-app/setup-readiness",
      setupReadinessReadyPayload
    ],
    [
      "/api/studio/current-app/setup-readiness/stream",
      setupReadinessReadyPayload
    ],
    [
      "/api/studio/current-app/capabilities",
      capabilitiesPayload
    ],
    [
      "/api/vibe64/tools",
      projectToolsPayload
    ],
    [
      "/api/studio/vibe64/tools",
      projectToolsPayload
    ],
    [
      "/api/studio/current-app",
      {
        adapter: {
          id: "jskit",
          label: "JSKIT"
        },
        git: {
          branch: "main",
          checked: true,
          dirty: false,
          isRepo: true
        },
        ok: true,
        ready: true,
        rootPath: targetRoot
      }
    ],
    [
      "/api/vibe64/sessions",
      {
        creation: {
          canCreate: true,
          defaultWorkflowDefinition: "big_feature",
          disabledReason: "",
          mode: "select",
          requiredWorkflowDefinition: null,
          seedRequired: false,
          workflowDefinitions: [
            {
              description: "Define, plan, implement, review, validate, commit, create a PR, and optionally merge.",
              id: "big_feature",
              label: "Make improvements"
            },
            {
              description: "Run a local maintenance task without commit, pull request, or merge steps.",
              id: "non_commit_maintenance",
              label: "Non-commit maintenance"
            }
          ]
        },
        limits: {
          maxOpenSessions: 5,
          openSessionCount: 0
        },
        ok: true,
        sessions: [],
        stepDefinitions: []
      }
    ]
  ]);
  const postApiPayloads = new Map<string, unknown>([
    [
      "/api/vibe64/project-runtime/close",
      {
        ok: true
      }
    ]
  ]);

  await mockLifecycleSocket(page);

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const apiPathname = unscopedApiPathname(url.pathname);

    if (url.pathname === "/api/auth/state" && method === "GET") {
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
      return;
    }

    if (method === "POST" && postApiPayloads.has(apiPathname)) {
      await fulfillJson(route, postApiPayloads.get(apiPathname));
      return;
    }

    if (method !== "GET" || !apiPayloads.has(apiPathname)) {
      throw new Error(`Self-contained smoke spec does not mock ${method} ${url.pathname}.`);
    }

    const remainingFailureCount = Number(failInitialGetCounts.get(apiPathname) || 0);
    if (remainingFailureCount > 0) {
      failInitialGetCounts.set(apiPathname, remainingFailureCount - 1);
      await route.abort("failed");
      return;
    }

    if (apiPathname === "/api/studio/current-app") {
      await projectConfigReady;
    }

    if (apiPathname.endsWith("/stream")) {
      await fulfillSse(route, apiPayloads.get(apiPathname));
    } else {
      await fulfillJson(route, apiPayloads.get(apiPathname));
    }

    if (apiPathname === "/api/vibe64/project-config") {
      markProjectConfigResolved();
    }
  });
}

function unscopedApiPathname(pathname = "") {
  if (!pathname.startsWith(SCOPED_API_PREFIX)) {
    return pathname;
  }
  return `/api${pathname.slice(SCOPED_API_PREFIX.length)}`;
}

async function mockLifecycleSocket(page: Page) {
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

async function fulfillJson(route: Route, payload: unknown) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: "application/json"
  });
}

async function fulfillSse(route: Route, payload: unknown) {
  await route.fulfill({
    body: `event: run.finished\ndata: ${JSON.stringify({
      status: payload
    })}\n\n`,
    contentType: "text/event-stream"
  });
}
