import { expect, test, type Page, type Route } from "@playwright/test";

import {
  DASHBOARD_PATH,
  DEVELOPMENT_PATH,
  SCOPED_API_PREFIX
} from "./support/base-shell-data";

const targetRoot = "/workspace/example-target-app";

test("home loads through a self-contained mocked Studio shell", async ({ page }) => {
  await mockReadyStudioShell(page);

  await page.goto(DEVELOPMENT_PATH);

  await expect(page).toHaveURL(developmentUrlPattern());
  await expect(page.getByRole("button", { name: "Menu" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tools" })).toHaveCount(0);
  await page.goto(`${DASHBOARD_PATH}/history`);
  await expect(page.getByRole("heading", { level: 1, name: "Session History", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await page.goto(DEVELOPMENT_PATH);
  await expect(page).toHaveURL(developmentUrlPattern());
  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible();
  await page.getByRole("button", { name: "Account settings" }).click();
  const accountConnectionsDialog = page.getByRole("dialog");
  await expect(accountConnectionsDialog.getByRole("heading", { level: 2, name: "Account settings" })).toBeVisible();
  await expect(accountConnectionsDialog.getByRole("heading", { level: 1, name: "Codex Connection" })).toBeVisible();
  const refreshAccountsButton = accountConnectionsDialog.getByRole("button", { name: "Refresh" });
  await expect(refreshAccountsButton).toBeEnabled();
  await refreshAccountsButton.click();
  await expect(refreshAccountsButton).toBeEnabled();
  await expect(accountConnectionsDialog.getByRole("button", { name: "Login with ChatGPT" })).toBeEnabled();
  await accountConnectionsDialog.getByRole("tab", { name: "GitHub" }).click();
  await expect(accountConnectionsDialog.getByRole("heading", { level: 1, name: "GitHub Connection" })).toBeVisible();
  await accountConnectionsDialog.getByRole("button", { name: "Close account settings" }).click();
  await expect(accountConnectionsDialog).toBeHidden();
  await expect(page.getByText("Session type", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(developmentUrlPattern());
});

test("safe read failures use JSKIT shell recovery retry", async ({ page }) => {
  let projectSelectionRecovered = false;
  await mockReadyStudioShell(page, {
    failGet(apiPathname) {
      return apiPathname === "/api/vibe64/projects" && !projectSelectionRecovered;
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

  projectSelectionRecovered = true;
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
  failGet?: (apiPathname: string) => boolean;
  failInitialGetCounts?: Record<string, number>;
};

async function mockReadyStudioShell(page: Page, options: MockReadyStudioShellOptions = {}) {
  const failInitialGetCounts = new Map(Object.entries(options.failInitialGetCounts || {}));
  const apiPayloads = new Map<string, unknown>([
    [
      "/api/vibe64/assistants/capabilities",
      {
        engines: [],
        ok: true,
        unavailable: true
      }
    ],
    [
      "/api/vibe64/accounts",
      {
        accounts: [],
        blockedReason: "",
        ok: true,
        credentialScopes: {
          codex: "app",
          github: "user"
        },
        ready: true
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
      "/api/vibe64/settings",
      {
        collaboration: {
          available: true,
          canEdit: true,
          choices: {},
          experience: "comfortable",
          explanationStyle: "concise",
          requirements: "",
          responseLength: "concise",
          source: { rootKind: "standalone-source", sessionId: "" },
          status: "configured",
          tone: "encouraging",
          unavailableReason: ""
        },
        developmentDatabase: {
          managed: false,
          scope: "external"
        },
        ok: true,
        promptHints: {
          canEdit: true,
          enabled: true
        }
      }
    ],
    [
      "/api/studio/current-app",
      {
        components: ["nodejs"],
        diagnostics: [],
        message: "",
        ok: true,
        ready: true,
        resources: [],
        root: targetRoot,
        runtimeRequirements: ["nodejs"],
        stackHash: "sha256:self-contained-smoke",
        status: "ready",
        targets: [{
          id: "web",
          label: "Web"
        }]
      }
    ],
    [
      "/api/vibe64/sessions",
      {
        creation: {
          canCreate: true,
          mode: "direct",
          showCreateAction: true
        },
        limits: {
          openSessionCount: 0
        },
        ok: true,
        sessions: []
      }
    ],
    [
      "/api/vibe64/sessions/archived",
      {
        ok: true,
        sessions: []
      }
    ]
  ]);
  const writeApiPayloads = new Map<string, unknown>([
    [
      "POST /api/vibe64/project-runtime/open",
      {
        ok: true,
        runtime: {
          open: true,
          reason: "unit-open",
          targetRoot
        },
        targetRoot
      }
    ],
    [
      "POST /api/vibe64/project-runtime/close",
      {
        ok: true
      }
    ],
    [
      "PUT /api/vibe64/sessions/current",
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

    const writeRequestKey = `${method} ${apiPathname}`;
    if (writeApiPayloads.has(writeRequestKey)) {
      await fulfillJson(route, writeApiPayloads.get(writeRequestKey));
      return;
    }

    if (method !== "GET" || !apiPayloads.has(apiPathname)) {
      throw new Error(`Self-contained smoke spec does not mock ${method} ${url.pathname}.`);
    }

    if (typeof options.failGet === "function" && options.failGet(apiPathname)) {
      await route.abort("failed");
      return;
    }

    const remainingFailureCount = Number(failInitialGetCounts.get(apiPathname) || 0);
    if (remainingFailureCount > 0) {
      failInitialGetCounts.set(apiPathname, remainingFailureCount - 1);
      await route.abort("failed");
      return;
    }

    await fulfillJson(route, apiPayloads.get(apiPathname));
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
