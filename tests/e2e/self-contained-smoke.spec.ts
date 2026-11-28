import { expect, test, type Page, type Route } from "@playwright/test";

import {
  DASHBOARD_PATH,
  DEVELOPMENT_PATH,
  SCOPED_API_PREFIX
} from "./support/base-shell-data";
import { expectReadableButton } from "./support/readable-button";
import { SHELL_READS } from "./support/shell-reads";
import { suppressAiOnboarding } from "./support/suppressAiOnboarding";

const targetRoot = "/workspace/example-target-app";

test("home loads through a self-contained mocked Studio shell", async ({ page }) => {
  await mockReadyStudioShell(page);

  await page.goto(DEVELOPMENT_PATH);

  await expect(page).toHaveURL(developmentUrlPattern());
  // The shell's bar is drawn before checking what it leaves out; the names are
  // exact because "Account menu" contains "Menu".
  await expect(page.getByRole("button", { name: "Account menu", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Menu", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tools", exact: true })).toHaveCount(0);
  await page.goto(`${DASHBOARD_PATH}/history`);
  await expect(page.getByRole("heading", { level: 2, name: "Session history", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
  await page.goto(DEVELOPMENT_PATH);
  await expect(page).toHaveURL(developmentUrlPattern());
  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible();
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  const accountMenu = page.locator(".vibe64-auth-settings__menu");
  await expect(accountMenu.getByText("Redo onboarding", { exact: true })).toBeVisible();
  await accountMenu.getByText("Account settings", { exact: true }).click();
  const accountConnectionsDialog = page.getByRole("dialog");
  await expect(accountConnectionsDialog.getByRole("heading", { level: 2, name: "Account settings" })).toBeVisible();
  // AI Accounts is the AI setup screen; its Advanced section (with Refresh) shows
  // once something is connected, and this shell has nothing connected.
  await expect(accountConnectionsDialog.getByRole("heading", { level: 2, name: "Pick the AI behind Vibe64" })).toBeVisible();
  await accountConnectionsDialog.getByRole("tab", { name: "GitHub" }).click();
  await expect(accountConnectionsDialog.getByRole("heading", { level: 2, name: "GitHub Connection" })).toBeVisible();
  await accountConnectionsDialog.getByRole("button", { name: "Close account settings" }).click();
  await expect(accountConnectionsDialog).toBeHidden();
  await expect(page.getByText("Session type", { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(developmentUrlPattern());

  // Redo onboarding opens onboarding, and focus comes back to the menu.
  const accountMenuButton = page.getByRole("button", { name: "Account menu", exact: true });
  const onboarding = page.locator('[aria-labelledby="ai-onboarding-title"]');
  await accountMenuButton.click();
  await accountMenu.getByText("Redo onboarding", { exact: true }).click();
  await expect(onboarding).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(onboarding).toBeHidden();
  await expect(accountMenuButton).toBeFocused();
});

test("an editor that does not answer shows Updating…, and after about a minute JSKIT's shell recovery with Retry", async ({ page }) => {
  // The project read and the page's health check get no answer, and keep getting none.
  let unanswered = true;
  await mockReadyStudioShell(page, {
    failGet(apiPathname) {
      return unanswered && (apiPathname === "/api/vibe64/projects" || apiPathname === "/api/health");
    }
  });

  await page.clock.install();
  await page.goto(DEVELOPMENT_PATH);
  const failingSince = await page.evaluate(() => Date.now());

  const banners = page.locator(".shell-error-host__banner");
  const updating = banners.filter({ hasText: "Updating…" });
  const recoveryMessage = "Projects could not reach the server or network. Check the connection and try again.";
  const recoveryBanner = banners.filter({ hasText: recoveryMessage });
  // The page's client waits for the editor on the page's own timers, asking again after each wait (at most 3 s), so
  // the test moves the page clock through one wait at a time.
  await expect(async () => {
    await page.clock.runFor(1_000);
    await expect(updating).toBeVisible({ timeout: 250 });
  }).toPass({ intervals: [100], timeout: 15_000 });
  await expect(recoveryBanner).toHaveCount(0);

  // After about a minute the client stops waiting, and JSKIT's shell offers recovery. (The page's other reads still
  // get answers, so Updating… clears whenever one does.)
  await expect(async () => {
    await page.clock.runFor(3_000);
    await expect(recoveryBanner).toBeVisible({ timeout: 250 });
  }).toPass({ intervals: [100], timeout: 40_000 });
  expect(await page.evaluate(() => Date.now()) - failingSince).toBeGreaterThanOrEqual(55_000);

  unanswered = false;
  await recoveryBanner.getByRole("button", { name: "Retry" }).click();

  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible({
    timeout: 15_000
  });
  await expect(recoveryBanner).toHaveCount(0);
  await expect(updating).toHaveCount(0);
});

test("a tab still running the build before an update offers Reload when it opens a page the update removed", async ({ page }) => {
  await mockReadyStudioShell(page);
  await page.goto(DEVELOPMENT_PATH);
  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible();

  // After an update the server has only the new build's files, so every file this tab has not loaded yet answers 404,
  // as the editor's server answers a hashed file it does not have (tests/server/webBuildFiles.unit.test.js).
  const missing: string[] = [];
  await page.route("**/assets/**", async (route) => {
    missing.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 404, contentType: "application/json", body: '{"statusCode":404,"error":"Not Found"}' });
  });
  // The tab's own router, as a link does.
  await page.evaluate((path) => {
    const app = (document.querySelector("#app") as unknown as { __vue_app__: { config: { globalProperties: { $router: { push(path: string): Promise<unknown> } } } } }).__vue_app__;
    return app.config.globalProperties.$router.push(path).catch(() => undefined);
  }, `${DASHBOARD_PATH}/history`);

  // JSKIT's shell names what failed (the page, or a module it loads) and offers Reload.
  const notice = page.getByRole("alert").filter({
    hasText: /did not download\. The app may have been updated, or the network request failed\./u
  });
  await expect(notice).toBeVisible();
  expect(missing.length).toBeGreaterThan(0);

  // The server now has the update's files: Reload opens the same address on them.
  await page.unroute("**/assets/**");
  await notice.getByRole("button", { name: "Reload" }).click();
  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible();
  await expect(notice).toHaveCount(0);
});

// After an update a page still running the build before it learns from realtime that the server serves another one
// (JSKIT's served client build). The editor shows that once, in one notice, and its buttons read as the controls they
// are on the notice's colour (WCAG's 4.5:1 for their words). On 28 Nov 2026 a restart for an update showed the green
// "Restarted for an update at 11:46. Nothing was lost." with faded Reload and Dismiss, and JSKIT's blue "Vibe64 was
// updated. Reload to get the latest version." under it, for the same update.
const PLANNED_RESTART_PATH = "/api/studio/health/planned-restart";
const UPDATED_SENTENCE = "Reload to get the latest version.";
// The build the server serves after the update, which no page here runs.
const UPDATED_BUILD = "0000000000000000";

test("after a restart for an update the page shows one notice, with Reload and Dismiss that read as enabled", async ({ page }) => {
  const realtime = await mockRealtime(page, UPDATED_BUILD);
  const restarted = { id: "restart-a", restartedAt: new Date().toISOString(), reason: "An update", sessions: 0, stopped: [] };
  await mockReadyStudioShell(page, {
    // The server's answer on 28 Nov: the restart's record, and the build it serves now.
    plannedRestart: () => ({ ok: true, active: null, restarted, clientBuildId: UPDATED_BUILD })
  });
  await page.goto(DEVELOPMENT_PATH);
  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible();
  await realtime.announced;

  const notice = page.getByTestId("vibe64-planned-restart-after");
  await expect(notice.getByRole("status")).toHaveText(
    new RegExp(`^Restarted for an update at \\d{2}:\\d{2}\\. Nothing was lost\\. ${UPDATED_SENTENCE.replace(".", "\\.")}$`, "u")
  );
  await expect(updateNotices(page)).toHaveCount(1);
  for (const name of ["Reload", "Dismiss"]) {
    await expectReadableButton(notice.getByRole("button", { name, exact: true }));
  }

  // Reload opens the same address again, which then runs the build the server serves: the message stays until it is
  // dismissed, without Reload.
  realtime.announce = await page.locator('meta[name="jskit-client-build"]').getAttribute("content") || "";
  expect(realtime.announce).toMatch(/^[0-9a-f]+$/u);
  const reloaded = page.waitForEvent("load");
  await notice.getByRole("button", { name: "Reload", exact: true }).click();
  await reloaded;
  await expect(notice.getByRole("status")).toHaveText(/^Restarted for an update at \d{2}:\d{2}\. Nothing was lost\.$/u);
  await expect(notice.getByRole("button", { name: "Reload", exact: true })).toHaveCount(0);
  await expectReadableButton(notice.getByRole("button", { name: "Dismiss", exact: true }));
  await notice.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(updateNotices(page)).toHaveCount(0);
});

test("an update without a planned restart shows JSKIT's offer to reload as the one notice, which Dismiss closes", async ({ page }) => {
  const realtime = await mockRealtime(page, UPDATED_BUILD);
  await mockReadyStudioShell(page);
  await page.goto(DEVELOPMENT_PATH);
  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible();
  await realtime.announced;

  const notice = page.getByTestId("vibe64-client-update");
  await expect(notice.getByRole("status")).toHaveText(`Vibe64 was updated. ${UPDATED_SENTENCE}`);
  await expect(updateNotices(page)).toHaveCount(1);
  for (const name of ["Reload", "Dismiss"]) {
    await expectReadableButton(notice.getByRole("button", { name, exact: true }));
  }
  await notice.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(updateNotices(page)).toHaveCount(0);
});

test("while the editor restarts for its planned restart the page says Updating… alone, and the countdown again once it answers", async ({ page }) => {
  let unanswered = false;
  const notice = { id: "restart-b", restartAt: new Date(Date.now() + 120_000).toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString(), reason: "An update" };
  await mockReadyStudioShell(page, {
    failGet: () => unanswered,
    plannedRestart: () => ({ ok: true, active: notice, restarted: null })
  });
  await page.goto(DEVELOPMENT_PATH);
  await expect(page.getByRole("button", { name: "New Session" })).toBeVisible();
  const countdown = page.getByTestId("vibe64-planned-restart-banner");
  await expect(countdown.getByRole("status")).toHaveText(/^This workspace restarts at \d{2}:\d{2} \(in 2 minutes\): An update\. /u);

  // The restart: nothing answers, and the page's next read (a page the person opens) finds no editor.
  unanswered = true;
  await page.evaluate((path) => {
    const app = (document.querySelector("#app") as unknown as { __vue_app__: { config: { globalProperties: { $router: { push(path: string): Promise<unknown> } } } } }).__vue_app__;
    return app.config.globalProperties.$router.push(path).catch(() => undefined);
  }, `${DASHBOARD_PATH}/history`);
  const updating = page.locator(".shell-error-host__banner").filter({ hasText: "Updating…" });
  await expect(updating).toBeVisible();
  await expect(countdown).toHaveCount(0);

  unanswered = false;
  await expect(updating).toHaveCount(0);
  await expect(countdown).toBeVisible();
});

/** Every notice on the page about the update: the editor's banners and JSKIT's. */
function updateNotices(page: Page) {
  return page.getByRole("alert").filter({ hasText: /\bupdate/iu });
}

/**
 * The page's realtime connection, answered here as the editor's server answers it (Socket.IO over a WebSocket): each
 * connection hears the build the server serves, JSKIT's realtime.served-client-build, from `announce` as it is then.
 * The test server never connects the mocked shell's page (it stays "Realtime disconnected"), so the page's socket is
 * answered here. `announced` resolves once the first connection was told.
 */
async function mockRealtime(page: Page, announce: string) {
  let told = () => {};
  const realtime = { announce, announced: new Promise<void>((resolve) => { told = resolve; }) };
  await page.routeWebSocket(/\/socket\.io\//u, (socket) => {
    // Engine.IO's open packet; no pings during a test.
    socket.send(`0${JSON.stringify({ sid: "e2e-engine", upgrades: [], pingInterval: 600_000, pingTimeout: 600_000, maxPayload: 1_000_000 })}`);
    socket.onMessage((message) => {
      // The client joins the default namespace ("40", with its auth), and is connected.
      if (!String(message).startsWith("40")) return;
      socket.send(`40${JSON.stringify({ sid: "e2e-socket" })}`);
      socket.send(`42${JSON.stringify(["realtime.served-client-build", { buildId: realtime.announce }])}`);
      told();
    });
  });
  return realtime;
}

function escapedPathPattern(pathValue: string) {
  return String(pathValue || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function developmentUrlPattern() {
  return new RegExp(`${escapedPathPattern(DEVELOPMENT_PATH)}$`, "u");
}

type MockReadyStudioShellOptions = {
  failGet?: (apiPathname: string) => boolean;
  failInitialGetCounts?: Record<string, number>;
  // The planned restart's read, in place of "no planned restart".
  plannedRestart?: () => unknown;
};

async function mockReadyStudioShell(page: Page, options: MockReadyStudioShellOptions = {}) {
  await suppressAiOnboarding(page);
  const failInitialGetCounts = new Map(Object.entries(options.failInitialGetCounts || {}));
  const apiPayloads = new Map<string, unknown>([
    // The editor is up, as its server answers: the page's client asks while it waits for an editor that did not answer.
    ["/api/health", { ok: true, app: "vibe64" }],
    ["/api/vibe64/accounts/codex-providers", { ok: true, providers: [] }],
    ["/api/vibe64/accounts/ai-connections", { ok: true, connections: [] }],
    ["/api/vibe64/training/learning-mode", { ok: true, available: true, learningMode: null }],
    ["/api/vibe64/training/courses", { ok: true, courses: [] }],
    ["/api/vibe64/training/learning", { ok: true, available: false }],
    ["/api/vibe64/colleague", { ok: false, error: "Colleague is not part of this smoke." }],
    ...SHELL_READS.map(([endpoint, payload]): [string, unknown] => [`/api${endpoint}`, payload]),
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

    await fulfillJson(route, apiPathname === PLANNED_RESTART_PATH && options.plannedRestart
      ? options.plannedRestart()
      : apiPayloads.get(apiPathname));
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
